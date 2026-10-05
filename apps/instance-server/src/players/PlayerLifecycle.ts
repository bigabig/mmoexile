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
import { getZone, isZoneId, type MapData, type ZoneId } from "@mmoexile/game-core";
import {
  PROTOCOL_VERSION,
  type KickReason,
} from "@mmoexile/protocol";
import type { InstanceHost, InstanceId } from "../cluster/index.js";
import { CharacterMapper, type PersistenceService } from "../persistence/index.js";
import type {
  CharacterOwnership,
  OwnedCharacter,
  Ownership,
} from "../ownership/CharacterOwnership.js";
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
  /** This server's region (sent with handoffs, for metrics). */
  region?: string;
  host: InstanceHost;
  db: PrismaClient;
  redis: Redis;
  broker: Broker;
  ownership: CharacterOwnership;
  leases: LeaseKeeper;
  /** Final saves, retried while the database is unavailable. */
  persistence: Pick<PersistenceService, "available" | "saveFinal" | "recordSuccess" | "recordFailure">;
  /**
   * How long a zone change waits (the character frozen) for its final save
   * while the database is unavailable, before giving up and asking the
   * player to join again (default 60 s).
   */
  handoffSaveWaitMs?: number;
  /** A zone change whose save took longer than this gets a fresh ticket (default 10 s). */
  ticketRefreshMs?: number;
  /** Public key for verifying tickets; only the orchestrator can sign. */
  ticketKey: TicketKey;
  /** Where zone changes are placed (the orchestrator). */
  allocator: ZoneAllocator;
  /**
   * False while the orchestrator can't be reached (e.g. this region is cut
   * off from the central cluster): zone changes are refused right away and
   * players keep playing where they are (D35). Default: reachable.
   */
  centralReachable?: () => boolean;
  /** Party lookup for tickets (the party travels with the player). */
  getPartyId: (characterId: string) => string | undefined;
  /**
   * Home region of the character's party leader, if any and online. A new
   * party instance is created there (D9); undefined means the player's own.
   */
  getLeaderRegion?: (characterId: string) => Promise<string | undefined>;
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
  /** When a player was last told that zone changes are paused (one notice per few seconds). */
  private pausedNoticeAt = new Map<string, number>();
  private readonly takeoverWaitMs: number;
  private readonly handoffSaveWaitMs: number;
  private readonly ticketRefreshMs: number;
  private readonly log: NonNullable<PlayerLifecycleDeps["log"]>;

  constructor(private readonly deps: PlayerLifecycleDeps) {
    this.takeoverWaitMs = deps.takeoverWaitMs ?? 5000;
    this.handoffSaveWaitMs = deps.handoffSaveWaitMs ?? 60_000;
    this.ticketRefreshMs = deps.ticketRefreshMs ?? 10_000;
    this.log = deps.log ?? (() => {});
  }

  /** Listens for "kick this character" requests from other servers. */
  async start(): Promise<void> {
    await this.deps.broker.subscribe(channels.sessionKick, (message) => {
      if (this.players.has(message.characterId)) {
        this.kick(message.characterId, message.reason).catch((err) =>
          this.log("Kick failed", { characterId: message.characterId, err: String(err) }),
        );
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
    this.pausedNoticeAt.delete(characterId);
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
    // Claim the ticket (once only), take ownership and load the latest save:
    // two central round trips in all (one Redis, one Postgres).
    const owned = await this.takeOwnership(ticket);
    if (owned === "replayed") return { ok: false, reason: "invalid_ticket" };
    if (owned === "missing") return { ok: false, reason: "character_unavailable" };
    const { ownership, character: record } = owned;
    if (!record.isAlive || record.accountId !== ticket.accountId) {
      await this.deps.ownership.release(ownership);
      return { ok: false, reason: "character_unavailable" };
    }

    const character = CharacterMapper.toDomain(record, record.nickname);
    let registered;
    try {
      registered = this.deps.host.registerPlayer({
        playerId: record.id,
        name: record.nickname,
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
      name: record.nickname,
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

  /**
   * Claims the ticket and takes ownership. Newest login wins: if another
   * session holds the character, ask it to leave (it saves and releases),
   * wait briefly, then take over by force.
   */
  private async takeOwnership(
    ticket: VerifiedTicket,
  ): Promise<{ ownership: Ownership; character: OwnedCharacter } | "replayed" | "missing"> {
    const { characterId } = ticket;
    const holder = { serverId: this.deps.serverId };
    // The ticket marker outlives the ticket, so a replay is always caught.
    const claimOnce = {
      key: redisKeys.usedTicket(ticket.ticketId),
      value: this.deps.serverId,
      ttlMs: Math.max(ticket.expiresAt - Date.now(), 0) + 60_000,
    };
    const first = await this.deps.ownership.acquire(characterId, holder, { claimOnce });
    if (first.ok) return first;
    if (first.reason === "claimed") return "replayed";
    if (first.reason === "missing") return "missing";

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
      if (retry.ok) return retry;
      if (retry.reason === "missing") return "missing";
    }
    this.log("Forcing takeover", { characterId });
    return (await this.deps.ownership.forceAcquire(characterId, holder)) ?? "missing";
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
    const notify = (text: string) =>
      this.deps.host.messageBus.publishChat({ sender: "System", text, kind: "system", targetPlayerIds: [characterId] });
    // While zone changes are paused, a player who keeps trying is told once every few seconds
    const notifyPaused = (text: string) => {
      const now = Date.now();
      if (now - (this.pausedNoticeAt.get(characterId) ?? 0) < 3000) return;
      this.pausedNoticeAt.set(characterId, now);
      notify(text);
    };
    try {
      // 0. The final save needs the database: while it is known to be
      // unavailable, the player stays where they are
      if (!this.deps.persistence.available) {
        if (options.notifyOnFailure !== false) {
          notifyPaused("The realm can't save right now, so zone changes are paused. Try again in a moment.");
        }
        return false;
      }
      // Placement needs the orchestrator: while it is known to be
      // unreachable, don't make the player wait for a failing allocation
      if (this.deps.centralReachable?.() === false) {
        if (options.notifyOnFailure !== false) {
          notifyPaused("The realm's central services can't be reached right now, so zone changes are paused. You can keep playing here.");
        }
        return false;
      }

      // 1. Where to? (the target instance is created if needed)
      const allocate = () => this.allocateFor(player, targetZoneId, via, options.excludeThisServer);
      let allocation;
      try {
        allocation = await allocate();
      } catch (err) {
        this.log("Allocation failed", { characterId, targetZoneId, err: String(err) });
        if (options.notifyOnFailure === false) return false;
        notify("That zone is not available right now. Try again in a moment.");
        return false;
      }
      if (this.players.get(characterId) !== player) return false; // left meanwhile

      // 2. Freeze: take the character out of the simulation
      const detached = this.deps.host.detachPlayer(characterId);
      this.depart(characterId);
      const ownership = this.deps.leases.untrack(characterId);
      if (!detached || !ownership) return false;

      // 3. Final save, only if we still own the character. It must land
      // before the target loads the character, so it comes first; if the
      // database fails right now, the character waits (frozen) for it.
      const savedAt = Date.now();
      const saved = await this.saveForHandoff(ownership, detached.state);
      if (saved === "fenced") {
        await this.releaseQuietly(ownership);
        this.deps.kickSession(characterId, "logged_in_elsewhere");
        return false;
      }
      if (saved === "unavailable") {
        // Saved later in the background; the lease is kept until then
        this.deps.kickSession(characterId, "service_unavailable");
        return false;
      }
      // Waited long for the database: the ticket may have expired meanwhile
      if (Date.now() - savedAt > this.ticketRefreshMs) {
        try {
          allocation = await allocate();
        } catch (err) {
          this.log("Allocation failed after a delayed save", { characterId, targetZoneId, err: String(err) });
          await this.releaseQuietly(ownership);
          this.deps.kickSession(characterId, "service_unavailable");
          return false;
        }
      }

      // 4. Send the client to the target with the orchestrator's ticket, and
      // release the lease meanwhile: the client needs at least three round
      // trips (this message, TCP, WebSocket upgrade) before the target asks
      // for the lease, the release one. If it were ever late, the target
      // just retries (see takeOwnership).
      this.deps.sendReconnect(characterId, allocation.url, allocation.ticket, targetZoneId);
      await this.releaseQuietly(ownership);
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
    // Still tracked (its lease renewed) until the final save is written
    const ownership = this.deps.leases.get(characterId);
    if (ownership && detached) {
      await this.saveAndRelease(ownership, detached.state);
    } else if (ownership) {
      this.deps.leases.untrack(characterId);
      await this.releaseQuietly(ownership);
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

  /**
   * Final save, then release the lease. While the database is unavailable
   * the save is retried in the background and the lease kept (renewed)
   * until it is written: nobody else can load the character's older state
   * meanwhile.
   */
  private async saveAndRelease(ownership: Ownership, state: PlayerPersistenceSnapshot): Promise<void> {
    const release = async () => {
      if (this.deps.leases.get(ownership.characterId) === ownership) {
        this.deps.leases.untrack(ownership.characterId);
      }
      await this.releaseQuietly(ownership);
    };
    const landed = await this.deps.persistence.saveFinal(ownership.characterId, state, () => void release());
    if (landed) {
      await release();
    } else {
      this.log("Final save pending: database unavailable", { characterId: ownership.characterId });
    }
  }

  /**
   * The final save of a zone change, written directly (fenced) while the
   * character is frozen. Retries while the database is unavailable, up to
   * handoffSaveWaitMs; then hands the save to the background retries
   * (keeping the lease) and reports "unavailable".
   */
  private async saveForHandoff(
    ownership: Ownership,
    state: PlayerPersistenceSnapshot,
  ): Promise<"saved" | "fenced" | "unavailable"> {
    const update = CharacterMapper.toPersistenceUpdate(state);
    const deadline = Date.now() + this.handoffSaveWaitMs;
    for (let attempt = 0; ; attempt++) {
      try {
        const written = await this.deps.ownership.writeFenced(ownership, update);
        this.deps.persistence.recordSuccess();
        return written ? "saved" : "fenced";
      } catch (err) {
        // Also tells everyone else that the database is unavailable: further
        // zone changes are refused instead of waiting like this one
        if (!this.deps.persistence.recordFailure("handoff", err)) throw err;
        const waitMs = Math.min(500 * 2 ** attempt, 5000);
        if (Date.now() + waitMs > deadline) {
          this.log("Zone change save gave up: database unavailable", { characterId: ownership.characterId });
          this.deps.leases.track(ownership);
          await this.saveAndRelease(ownership, state);
          return "unavailable";
        }
        this.log("Zone change save failed, retrying", { characterId: ownership.characterId, attempt, err: String(err) });
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  private async allocateFor(
    player: AdmittedPlayer,
    targetZoneId: ZoneId,
    via: { sourceInstanceId: InstanceId; portalId: string } | undefined,
    excludeThisServer: boolean | undefined,
  ) {
    const { characterId } = player;
    const leaderRegion =
      getZone(targetZoneId)?.access.kind === "party_private"
        ? await this.deps.getLeaderRegion?.(characterId).catch(() => undefined)
        : undefined;
    return this.deps.allocator.allocate({
      zoneId: targetZoneId,
      characterId,
      accountId: player.accountId,
      region: player.homeRegion,
      leaderRegion,
      fromRegion: this.deps.region,
      partyId: this.deps.getPartyId(characterId),
      via,
      excludeServerId: excludeThisServer ? this.deps.serverId : undefined,
    });
  }

  /** Releases a lease; if Redis is unavailable it simply runs out (LEASE_TTL_MS). */
  private async releaseQuietly(ownership: Ownership): Promise<void> {
    try {
      await this.deps.ownership.release(ownership);
    } catch (err) {
      this.log("Lease release failed, it will expire", { characterId: ownership.characterId, err: String(err) });
    }
  }
}
