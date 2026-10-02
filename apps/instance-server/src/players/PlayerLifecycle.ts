import type { Character, PrismaClient } from "@mmoexile/db";
import type { Redis, Broker } from "@mmoexile/messaging";
import {
  channels,
  redisKeys,
  serverForZone,
  type StaticPlacement,
} from "@mmoexile/contracts";
import {
  InvalidTokenError,
  signTicket,
  verifyTicket,
  type VerifiedTicket,
} from "@mmoexile/auth";
import { isZoneId, type MapData, type ZoneId } from "@mmoexile/game-core";
import {
  PROTOCOL_VERSION,
  type KickReason,
} from "@mmoexile/protocol";
import type { InstanceHost, InstanceId } from "../cluster/index.js";
import { CharacterMapper } from "../persistence/index.js";
import type { CharacterOwnership, Ownership } from "../ownership/CharacterOwnership.js";
import type { LeaseKeeper } from "../ownership/LeaseKeeper.js";
import type { PlayerPersistenceSnapshot } from "@mmoexile/simulation";
import type { CharacterData } from "@mmoexile/game-core";

/** A character currently admitted to this server. */
export interface AdmittedPlayer {
  characterId: string;
  accountId: string;
  name: string;
  instanceId: InstanceId;
  zoneId: ZoneId;
  map: MapData;
  character: CharacterData;
  /** The stored row as loaded on admission (max HP, defense, …). */
  record: Character;
  /** Entered through a portal (zone change) rather than a fresh login. */
  arrivedViaPortal: boolean;
}

export type AdmitResult =
  | { ok: true; player: AdmittedPlayer }
  | { ok: false; reason: KickReason };

export interface PlayerLifecycleDeps {
  serverId: string;
  host: InstanceHost;
  db: PrismaClient;
  redis: Redis;
  broker: Broker;
  ownership: CharacterOwnership;
  leases: LeaseKeeper;
  placement: StaticPlacement;
  ticketKey: Uint8Array;
  /** Party lookup for tickets (the party travels with the player). */
  getPartyId: (characterId: string) => string | undefined;
  /** Tell the client to reconnect elsewhere. */
  sendReconnect: (characterId: string, url: string, ticket: string, zoneId: string) => void;
  /** End a client session with a reason. */
  kickSession: (characterId: string, reason: KickReason) => void;
  /** A character is now on this server (presence, party cache, …). */
  onAdmitted?: (player: AdmittedPlayer) => void;
  /** A character left this server for any reason. */
  onDeparted?: (characterId: string, name: string) => void;
  /** How long a duplicate login waits for the old session before forcing. */
  takeoverWaitMs?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/**
 * Everything that happens to a character on this server:
 * - admit: verify ticket → claim it once → take ownership → load → enter
 * - hand off: save (fenced) → release ownership → new ticket → reconnect
 * - leave / kick / shutdown: save (fenced) → release ownership
 * - fenced: someone else took over → drop without saving
 */
export class PlayerLifecycle {
  private players = new Map<string, AdmittedPlayer>();
  private readonly takeoverWaitMs: number;
  private readonly log: NonNullable<PlayerLifecycleDeps["log"]>;

  constructor(private readonly deps: PlayerLifecycleDeps) {
    this.takeoverWaitMs = deps.takeoverWaitMs ?? 5000;
    this.log = deps.log ?? (() => {});
  }

  /** Listens for "kick this character" requests from other servers. */
  async start(): Promise<void> {
    await this.deps.broker.subscribe(channels.sessionKick, (message) => {
      if (this.players.has(message.characterId)) {
        void this.kick(message.characterId, message.reason);
      }
    });
  }

  get(characterId: string): AdmittedPlayer | undefined {
    return this.players.get(characterId);
  }

  all(): AdmittedPlayer[] {
    return [...this.players.values()];
  }

  /** Forgets a character locally and reports its departure. */
  private depart(characterId: string): void {
    const player = this.players.get(characterId);
    this.players.delete(characterId);
    if (player) this.deps.onDeparted?.(characterId, player.name);
  }

  // --- Admission ---

  async admit(ticketToken: string, protocolVersion: number): Promise<AdmitResult> {
    if (protocolVersion !== PROTOCOL_VERSION) {
      return { ok: false, reason: "version_mismatch" };
    }

    let ticket: VerifiedTicket;
    try {
      ticket = await verifyTicket(ticketToken, this.deps.ticketKey, this.deps.serverId);
    } catch (err) {
      if (err instanceof InvalidTokenError) return { ok: false, reason: "invalid_ticket" };
      throw err;
    }
    if (!isZoneId(ticket.zoneId) || serverForZone(this.deps.placement, ticket.zoneId).serverId !== this.deps.serverId) {
      return { ok: false, reason: "invalid_ticket" };
    }
    if (!(await this.claimTicket(ticket))) {
      return { ok: false, reason: "invalid_ticket" };
    }

    const ownership = await this.takeOwnership(ticket.characterId);

    // Load the character only after owning it, so we read the latest save.
    const record = await this.deps.db.character.findUnique({
      where: { id: ticket.characterId },
      include: { account: true },
    });
    if (!record || !record.isAlive || record.accountId !== ticket.accountId) {
      await this.deps.ownership.release(ownership);
      return { ok: false, reason: "character_unavailable" };
    }

    const character = CharacterMapper.toDomain(record, record.account.nickname);
    let registered;
    try {
      registered = this.deps.host.registerPlayer({
        playerId: record.id,
        name: record.account.nickname,
        charId: record.id,
        zoneId: ticket.zoneId,
        character,
        partyId: ticket.partyId,
        via: ticket.via,
        allowPrivateZones: true,
      });
    } catch (err) {
      await this.deps.ownership.release(ownership);
      throw err;
    }

    this.deps.leases.track(ownership);
    const player: AdmittedPlayer = {
      characterId: record.id,
      accountId: record.accountId,
      name: record.account.nickname,
      instanceId: registered.instanceId,
      zoneId: registered.zoneId,
      map: registered.map,
      character,
      record,
      arrivedViaPortal: ticket.via !== undefined,
    };
    this.players.set(player.characterId, player);
    this.deps.onAdmitted?.(player);
    this.log("Admitted", { characterId: player.characterId, instanceId: player.instanceId, ticketId: ticket.ticketId });
    return { ok: true, player };
  }

  /** Marks a ticket as used; false if it was used before (replay). */
  private async claimTicket(ticket: VerifiedTicket): Promise<boolean> {
    const ttlMs = Math.max(ticket.expiresAt - Date.now(), 0) + 60_000;
    const result = await this.deps.redis.set(
      redisKeys.usedTicket(ticket.ticketId),
      this.deps.serverId,
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  }

  /**
   * Newest login wins: if another session holds the character, ask it to
   * leave (it saves and releases), wait briefly, then take over by force.
   */
  private async takeOwnership(characterId: string): Promise<Ownership> {
    const holder = { serverId: this.deps.serverId };
    const first = await this.deps.ownership.acquire(characterId, holder);
    if (first.ok) return first.ownership;

    if (this.players.has(characterId)) {
      await this.kick(characterId, "logged_in_elsewhere");
    } else {
      await this.deps.broker.publish(channels.sessionKick, {
        characterId,
        reason: "logged_in_elsewhere",
      });
    }

    const deadline = Date.now() + this.takeoverWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const retry = await this.deps.ownership.acquire(characterId, holder);
      if (retry.ok) return retry.ownership;
    }
    this.log("Forcing takeover", { characterId });
    return this.deps.ownership.forceAcquire(characterId, holder);
  }

  // --- Handoff ---

  /**
   * Moves a character to another zone via reconnect (also when the zone is
   * hosted here, see decision D4).
   */
  async handOff(
    characterId: string,
    targetZoneId: string,
    via: { sourceInstanceId: InstanceId; portalId: string },
  ): Promise<boolean> {
    const player = this.players.get(characterId);
    if (!player || !isZoneId(targetZoneId)) return false;
    const target = serverForZone(this.deps.placement, targetZoneId);

    // 1. Freeze: take the character out of the simulation
    const detached = this.deps.host.detachPlayer(characterId);
    this.depart(characterId);
    const ownership = this.deps.leases.untrack(characterId);
    if (!detached || !ownership) return false;

    // 2. Final save, only if we still own the character
    if (!(await this.saveAndRelease(ownership, detached.state))) {
      this.deps.kickSession(characterId, "logged_in_elsewhere");
      return false;
    }

    // 3. Ticket for the target server, then tell the client
    const ticket = await signTicket(
      {
        characterId,
        accountId: player.accountId,
        zoneId: targetZoneId,
        targetServerId: target.serverId,
        partyId: this.deps.getPartyId(characterId),
        via,
      },
      this.deps.ticketKey,
    );
    this.deps.sendReconnect(characterId, target.url, ticket, targetZoneId);
    this.log("Handed off", { characterId, targetZoneId, targetServerId: target.serverId });
    return true;
  }

  // --- Leaving ---

  /** Client disconnected: save and release. */
  async leave(characterId: string): Promise<void> {
    this.depart(characterId);
    const detached = this.deps.host.detachPlayer(characterId);
    const ownership = this.deps.leases.untrack(characterId);
    if (ownership && detached) {
      await this.saveAndRelease(ownership, detached.state);
    } else if (ownership) {
      await this.deps.ownership.release(ownership);
    }
  }

  /** Another session takes over (or the server stops): save, release, kick. */
  async kick(characterId: string, reason: KickReason): Promise<void> {
    if (!this.players.has(characterId)) return;
    await this.leave(characterId);
    this.deps.kickSession(characterId, reason);
  }

  /** Someone else owns the character now: drop it without saving. */
  dropFenced(characterId: string): void {
    if (!this.players.has(characterId)) return;
    this.depart(characterId);
    this.deps.leases.untrack(characterId);
    this.deps.host.detachPlayer(characterId);
    this.deps.kickSession(characterId, "logged_in_elsewhere");
    this.log("Dropped fenced character", { characterId });
  }

  /** Server shutdown: save and release every character, then kick them. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.players.keys()].map((id) => this.kick(id, "server_shutdown")),
    );
  }

  private async saveAndRelease(
    ownership: Ownership,
    state: PlayerPersistenceSnapshot,
  ): Promise<boolean> {
    const saved = await this.deps.ownership.writeFenced(
      ownership,
      CharacterMapper.toPersistenceUpdate(state),
    );
    await this.deps.ownership.release(ownership);
    return saved;
  }
}
