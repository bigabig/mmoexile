import { randomUUID } from "node:crypto";
import type { Redis } from "@mmoexile/messaging";
import { withDatabaseTimeout, type Character, type PrismaClient, type Prisma } from "@mmoexile/db";
import { redisKeys } from "@mmoexile/contracts";

/**
 * Exactly one server may own a character at a time. Two mechanisms:
 *
 * 1. Lease (Redis): `lease:char:<id>`, set only if absent, expires unless
 *    renewed. If the owning server dies, the lease runs out and the character
 *    can be claimed elsewhere.
 * 2. Fencing epoch (Postgres): taking ownership increments
 *    Character.ownerEpoch, and every state write is conditional on it. A
 *    server that lost its lease without noticing (paused process, network
 *    split) writes 0 rows instead of overwriting newer data.
 *
 * Instance servers may be far from Redis and Postgres (Stage 4 regions), so
 * every step is one round trip: claiming a one-time key (the transfer
 * ticket) and the lease is one Redis script, bumping the epoch also loads
 * the character, and a fenced write is a single UPDATE.
 */

export interface LeaseHolder {
  serverId: string;
  instanceId?: string;
}

export interface Ownership {
  characterId: string;
  epoch: number;
  /** Exact lease value we wrote; renew/release compare against it. */
  leaseValue: string;
}

/** The character as stored, read in the same round trip as taking ownership. */
export type OwnedCharacter = Character & { nickname: string };

export type AcquireResult =
  | { ok: true; ownership: Ownership; character: OwnedCharacter }
  /** Another server holds the lease. */
  | { ok: false; reason: "held"; heldBy: LeaseHolder }
  /** The one-time key was claimed before (a replayed ticket). */
  | { ok: false; reason: "claimed" }
  /** No such character. */
  | { ok: false; reason: "missing" };

/** A one-time key claimed together with the lease, e.g. a used ticket marker. */
export interface ClaimOnce {
  key: string;
  value: string;
  ttlMs: number;
}

/** Columns a fenced write may set (keys of CharacterMapper.toPersistenceUpdate). */
const WRITABLE_COLUMNS = new Set([
  "hp", "mp", "level", "xp", "x", "y", "lastZoneId", "isAlive", "deathReason",
  "equippedWeapon", "equippedArmor", "inventory", "maxHp", "maxMp", "defense",
  "speed", "attack", "dexterity",
]);
const JSON_COLUMNS = new Set(["inventory"]);

export interface CharacterOwnershipOptions {
  redis: Redis;
  db: PrismaClient;
  leaseTtlMs?: number;
  /** Longest wait for a database statement (default 6 s) before it counts as unavailable. */
  dbTimeoutMs?: number;
  /** For metrics: someone else held the lease / a write was fenced. */
  onLeaseConflict?: () => void;
  onFencedWrite?: () => void;
  /** Every character write's duration (metrics: the database as servers see it). */
  onWriteDuration?: (ms: number) => void;
}

// Claims the optional one-time key (KEYS[2]), then the lease (KEYS[1]).
// 1: lease taken, 0: lease held by someone else, -1: one-time key used.
const CLAIM_AND_LEASE = `
if KEYS[2] and not redis.call("SET", KEYS[2], ARGV[3], "PX", ARGV[4], "NX") then
  return -1
end
if redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX") then
  return 1
end
return 0`;

// Renew only if the lease still holds exactly our value, or is gone
// altogether (Redis restarted empty, or it ran out while Redis was
// unreachable): then nobody else holds it and we take it back. Safe because
// the fencing epoch, not the lease, protects the data: had someone taken
// over meanwhile, our next write would be refused.
const RENEW_IF_OURS = `
local current = redis.call("GET", KEYS[1])
if current == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if not current then
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
  return 1
end
return 0`;
// Release only if the lease still holds exactly our value.
const RELEASE_IF_OURS = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

export class CharacterOwnership {
  public readonly leaseTtlMs: number;
  private readonly redis: Redis;
  private readonly db: PrismaClient;
  private readonly dbTimeoutMs: number;
  private readonly onLeaseConflict: () => void;
  private readonly onFencedWrite: () => void;
  private readonly onWriteDuration: (ms: number) => void;

  constructor(options: CharacterOwnershipOptions) {
    this.redis = options.redis;
    this.db = options.db;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.dbTimeoutMs = options.dbTimeoutMs ?? 6000;
    this.onLeaseConflict = options.onLeaseConflict ?? (() => {});
    this.onFencedWrite = options.onFencedWrite ?? (() => {});
    this.onWriteDuration = options.onWriteDuration ?? (() => {});
  }

  /**
   * Takes ownership if nobody holds the lease, and loads the character
   * (latest save) in the same database round trip. With `claimOnce`, a
   * one-time key is claimed in the same Redis round trip, before the lease.
   */
  async acquire(
    characterId: string,
    holder: LeaseHolder,
    options: { claimOnce?: ClaimOnce } = {},
  ): Promise<AcquireResult> {
    const key = redisKeys.lease(characterId);
    const leaseValue = this.leaseValueFor(holder);
    const claim = options.claimOnce;
    const result = claim
      ? await this.redis.eval(CLAIM_AND_LEASE, 2, key, claim.key, leaseValue, String(this.leaseTtlMs), claim.value, String(claim.ttlMs))
      : await this.redis.eval(CLAIM_AND_LEASE, 1, key, leaseValue, String(this.leaseTtlMs));
    if (result === -1) return { ok: false, reason: "claimed" };
    if (result !== 1) {
      this.onLeaseConflict();
      return { ok: false, reason: "held", heldBy: await this.currentHolder(characterId) };
    }

    const ownership = { characterId, epoch: 0, leaseValue };
    try {
      const character = await this.takeOver(characterId);
      if (!character) {
        await this.release(ownership);
        return { ok: false, reason: "missing" };
      }
      return { ok: true, ownership: { ...ownership, epoch: character.ownerEpoch }, character };
    } catch (err) {
      await this.release(ownership);
      throw err;
    }
  }

  /**
   * Takes ownership even if another server holds the lease ("newest login
   * wins"). Bumping the epoch first fences the previous owner's writes.
   * Undefined if there is no such character.
   */
  async forceAcquire(
    characterId: string,
    holder: LeaseHolder,
  ): Promise<{ ownership: Ownership; character: OwnedCharacter } | undefined> {
    const character = await this.takeOver(characterId);
    if (!character) return undefined;
    const leaseValue = this.leaseValueFor(holder);
    await this.redis.set(redisKeys.lease(characterId), leaseValue, "PX", this.leaseTtlMs);
    return { ownership: { characterId, epoch: character.ownerEpoch, leaseValue }, character };
  }

  /** Extends (or takes back a vanished) lease; false means someone else holds it now. */
  async renew(ownership: Ownership): Promise<boolean> {
    const result = await this.redis.eval(
      RENEW_IF_OURS,
      1,
      redisKeys.lease(ownership.characterId),
      ownership.leaseValue,
      String(this.leaseTtlMs),
    );
    return result === 1;
  }

  /** Gives up ownership; a no-op if someone else holds the lease by now. */
  async release(ownership: Ownership): Promise<boolean> {
    const result = await this.redis.eval(
      RELEASE_IF_OURS,
      1,
      redisKeys.lease(ownership.characterId),
      ownership.leaseValue,
    );
    return result === 1;
  }

  /**
   * Writes character state only if we still own it. Returns false when the
   * write was fenced (another server took over), in which case the caller
   * must drop the character.
   */
  async writeFenced(
    ownership: Ownership,
    data: Prisma.CharacterUpdateManyMutationInput,
  ): Promise<boolean> {
    // One plain UPDATE: Prisma's updateMany would wrap it in BEGIN/COMMIT,
    // three round trips instead of one.
    const values: unknown[] = [];
    const assignments: string[] = [];
    for (const [column, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (!WRITABLE_COLUMNS.has(column) || (typeof value === "object" && value !== null && !JSON_COLUMNS.has(column))) {
        throw new Error(`writeFenced: unsupported update of ${column}`);
      }
      values.push(JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
      assignments.push(`"${column}" = $${values.length}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`);
    }
    values.push(ownership.characterId, ownership.epoch);
    const started = performance.now();
    const count = await withDatabaseTimeout(
      this.db.$executeRawUnsafe(
        `UPDATE "Character" SET ${[...assignments, `"updatedAt" = NOW()`].join(", ")}
         WHERE "id" = $${values.length - 1} AND "ownerEpoch" = $${values.length}`,
        ...values,
      ),
      this.dbTimeoutMs,
    );
    this.onWriteDuration(performance.now() - started);
    if (count !== 1) this.onFencedWrite();
    return count === 1;
  }

  async currentHolder(characterId: string): Promise<LeaseHolder> {
    const raw = await this.redis.get(redisKeys.lease(characterId));
    if (!raw) return { serverId: "unknown" };
    const { serverId, instanceId } = JSON.parse(raw) as LeaseHolder;
    return instanceId === undefined ? { serverId } : { serverId, instanceId };
  }

  /** Our lease value: the holder plus a unique token, so renew/release only touch our own lease. */
  private leaseValueFor(holder: LeaseHolder): string {
    return JSON.stringify({ ...holder, token: randomUUID() });
  }

  /** Bumps the fencing epoch and returns the character with its account's nickname, in one statement. */
  private async takeOver(characterId: string): Promise<OwnedCharacter | undefined> {
    const rows = await withDatabaseTimeout(
      this.db.$queryRaw<OwnedCharacter[]>`
        UPDATE "Character" AS c
        SET "ownerEpoch" = c."ownerEpoch" + 1, "updatedAt" = NOW()
        FROM "Account" AS a
        WHERE c."id" = ${characterId} AND a."id" = c."accountId"
        RETURNING c.*, a."nickname" AS "nickname"`,
      this.dbTimeoutMs,
    );
    return rows[0];
  }
}
