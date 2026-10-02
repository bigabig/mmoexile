import type { Redis } from "@mmoexile/messaging";
import type { PrismaClient, Prisma } from "@mmoexile/db";
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

export type AcquireResult =
  | { ok: true; ownership: Ownership }
  | { ok: false; heldBy: LeaseHolder & { epoch: number } };

export interface CharacterOwnershipOptions {
  redis: Redis;
  db: PrismaClient;
  leaseTtlMs?: number;
  /** For metrics: someone else held the lease / a write was fenced. */
  onLeaseConflict?: () => void;
  onFencedWrite?: () => void;
}

// Renew/release only if the lease still holds exactly our value.
const RENEW_IF_OURS = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`;
const RELEASE_IF_OURS = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

export class CharacterOwnership {
  public readonly leaseTtlMs: number;
  private readonly redis: Redis;
  private readonly db: PrismaClient;
  private readonly onLeaseConflict: () => void;
  private readonly onFencedWrite: () => void;

  constructor(options: CharacterOwnershipOptions) {
    this.redis = options.redis;
    this.db = options.db;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.onLeaseConflict = options.onLeaseConflict ?? (() => {});
    this.onFencedWrite = options.onFencedWrite ?? (() => {});
  }

  /** Takes ownership if nobody holds the lease. */
  async acquire(
    characterId: string,
    holder: LeaseHolder,
  ): Promise<AcquireResult> {
    const key = redisKeys.lease(characterId);
    // Reserve the lease first; the real value (with epoch) follows below.
    const placeholder = JSON.stringify({ ...holder, epoch: -1 });
    const reserved = await this.redis.set(
      key,
      placeholder,
      "PX",
      this.leaseTtlMs,
      "NX",
    );
    if (reserved !== "OK") {
      this.onLeaseConflict();
      return { ok: false, heldBy: await this.currentHolder(characterId) };
    }

    try {
      const epoch = await this.bumpEpoch(characterId);
      const leaseValue = JSON.stringify({ ...holder, epoch });
      await this.redis.set(key, leaseValue, "PX", this.leaseTtlMs, "XX");
      return { ok: true, ownership: { characterId, epoch, leaseValue } };
    } catch (err) {
      await this.redis.eval(RELEASE_IF_OURS, 1, key, placeholder);
      throw err;
    }
  }

  /**
   * Takes ownership even if another server holds the lease ("newest login
   * wins"). Bumping the epoch first fences the previous owner's writes.
   */
  async forceAcquire(
    characterId: string,
    holder: LeaseHolder,
  ): Promise<Ownership> {
    const epoch = await this.bumpEpoch(characterId);
    const leaseValue = JSON.stringify({ ...holder, epoch });
    await this.redis.set(
      redisKeys.lease(characterId),
      leaseValue,
      "PX",
      this.leaseTtlMs,
    );
    return { characterId, epoch, leaseValue };
  }

  /** Extends the lease; false means we no longer own the character. */
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
    const { count } = await this.db.character.updateMany({
      where: { id: ownership.characterId, ownerEpoch: ownership.epoch },
      data,
    });
    if (count !== 1) this.onFencedWrite();
    return count === 1;
  }

  async currentHolder(
    characterId: string,
  ): Promise<LeaseHolder & { epoch: number }> {
    const raw = await this.redis.get(redisKeys.lease(characterId));
    return raw ? JSON.parse(raw) : { serverId: "unknown", epoch: -1 };
  }

  private async bumpEpoch(characterId: string): Promise<number> {
    const updated = await this.db.character.update({
      where: { id: characterId },
      data: { ownerEpoch: { increment: 1 } },
      select: { ownerEpoch: true },
    });
    return updated.ownerEpoch;
  }
}
