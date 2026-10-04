import type { Character, PrismaClient } from "@mmoexile/db";
import type { Redis, Broker } from "@mmoexile/messaging";
import { channels, redisKeys, RegionId } from "@mmoexile/contracts";
import {
  InvalidTokenError,
  verifyTicket,
  type TicketKey,
  type VerifiedTicket,
} from "@mmoexile/auth";
import type { ZoneAllocator } from "../fleet/ZoneAllocator.js";
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
  /**
   * The region the player chose at login (from the ticket). Public zones
   * are allocated there, also when this server is in another region.
   */
  homeRegion: string;
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
  /** Public key for verifying tickets; only the orchestrator can sign. */
  ticketKey: TicketKey;
  /** Where zone changes are placed (the orchestrator). */
  allocator: ZoneAllocator;
  /** Party lookup for tickets (the party travels with the player). */
  getPartyId: (characterId: string) => string | undefined;
  /** Tell the client to reconnect elsewhere. */
  sendReconnect: (characterId: string, url: string, ticket: string, zoneId: string) => void;
  /** End a client session with a reason. */
  kickSession: (characterId: string, reason: KickReason) => void;
  /** A character is now on this server (presence, party cache, …). */
  onAdmitted?: (player: AdmittedPlayer, ticket: VerifiedTicket) => void;
  /** A character left this server for any reason. */
  onDeparted?: (characterId: string, name: string) => void;
  /** Admission refused (metrics). */
  onRejected?: (reason: KickReason) => void;
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
  private handingOff = new Set<string>();
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
    const result = await this.tryAdmit(ticketToken, protocolVersion);
    if (!result.ok) this.deps.onRejected?.(result.reason);
    return result;
  }

  private async tryAdmit(ticketToken: string, protocolVersion: number): Promise<AdmitResult> {
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
    if (!isZoneId(ticket.zoneId) || !RegionId.safeParse(ticket.region).success) {
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
        instanceId: ticket.instanceId,
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
      homeRegion: ticket.region,
    };
    this.players.set(player.characterId, player);
    this.deps.onAdmitted?.(player, ticket);
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
   * hosted here, see decision D4). The orchestrator picks the instance and
   * issues the ticket first, so a failed allocation leaves the character
   * where it is.
   */
  async handOff(
    characterId: string,
    targetZoneId: string,
    via?: { sourceInstanceId: InstanceId; portalId: string },
    options: {
      /** Never place on this server (draining). */
      excludeThisServer?: boolean;
      /** Tell the player in chat when the zone can't be reached (default). */
      notifyOnFailure?: boolean;
    } = {},
  ): Promise<boolean> {
    const player = this.players.get(characterId);
    if (!player || !isZoneId(targetZoneId) || this.handingOff.has(characterId)) {
      return false;
    }
    this.handingOff.add(characterId);
    try {
      // 1. Where to? (the target instance is created if needed)
      let allocation;
      try {
        allocation = await this.deps.allocator.allocate({
          zoneId: targetZoneId,
          characterId,
          accountId: player.accountId,
          region: player.homeRegion,
          partyId: this.deps.getPartyId(characterId),
          via,
          excludeServerId: options.excludeThisServer ? this.deps.serverId : undefined,
        });
      } catch (err) {
        this.log("Allocation failed", { characterId, targetZoneId, err: String(err) });
        if (options.notifyOnFailure === false) return false;
        this.deps.host.messageBus.publishChat({
          sender: "System",
          text: "That zone is not available right now. Try again in a moment.",
          kind: "system",
          targetPlayerIds: [characterId],
        });
        return false;
      }
      if (this.players.get(characterId) !== player) return false; // left meanwhile

      // 2. Freeze: take the character out of the simulation
      const detached = this.deps.host.detachPlayer(characterId);
      this.depart(characterId);
      const ownership = this.deps.leases.untrack(characterId);
      if (!detached || !ownership) return false;

      // 3. Final save, only if we still own the character
      if (!(await this.saveAndRelease(ownership, detached.state))) {
        this.deps.kickSession(characterId, "logged_in_elsewhere");
        return false;
      }

      // 4. Send the client to the target with the orchestrator's ticket
      this.deps.sendReconnect(characterId, allocation.url, allocation.ticket, targetZoneId);
      this.log("Handed off", {
        characterId,
        targetZoneId,
        targetServerId: allocation.serverId,
        instanceId: allocation.instanceId,
        ticketId: allocation.ticketId,
      });
      return true;
    } finally {
      this.handingOff.delete(characterId);
    }
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
