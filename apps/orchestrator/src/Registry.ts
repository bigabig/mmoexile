import type {
  HeartbeatBody,
  InstanceReport,
  ServerIdentity,
  ServerState,
  ServerView,
} from "@mmoexile/contracts";

/** An instance as the orchestrator knows it. */
export interface InstanceEntry extends InstanceReport {
  serverId: string;
  /** When the orchestrator created it; unset if first seen in a heartbeat. */
  createdAt?: number;
  /**
   * Allocations not yet visible in a heartbeat (the player is still on the
   * way). Counted as players so a burst of allocations doesn't overfill.
   */
  reservations: number[];
}

export interface ServerEntry extends ServerIdentity {
  state: ServerState;
  instances: Map<string, InstanceEntry>;
  tickP95Ms: number;
  cpu: number;
  eventLoopUtilization: number;
  lastHeartbeat: number;
  /** When a player was last sent here (see `holds`). */
  lastReservedAt?: number;
}

export interface RegistryOptions {
  now?: () => number;
  /** A server that sent no heartbeat for this long is dead (3 × 2 s). */
  deadAfterMs?: number;
  /**
   * A server silent for this long gets no new players, even before it is
   * declared dead (1.5 × 2 s): a crashed server is avoided sooner.
   */
  staleAfterMs?: number;
  /** Dead and stopped servers are forgotten after this long. */
  forgetAfterMs?: number;
  /**
   * Instances the orchestrator just created are kept even if a heartbeat
   * doesn't list them yet (it may have been built before the creation).
   */
  creationGraceMs?: number;
  /** Reservations older than this are covered by heartbeats. */
  reservationTtlMs?: number;
  /** How long after sending a player to a server it is asked to hold (see `holds`). */
  holdMs?: number;
}

/**
 * The fleet as the orchestrator sees it: every instance server and the
 * instances on it. Lives in memory and is rebuilt from heartbeats, so an
 * orchestrator restart loses nothing that matters.
 */
export class Registry {
  private servers = new Map<string, ServerEntry>();
  private readonly now: () => number;
  private readonly deadAfterMs: number;
  private readonly staleAfterMs: number;
  private readonly forgetAfterMs: number;
  private readonly creationGraceMs: number;
  private readonly reservationTtlMs: number;
  private readonly holdMs: number;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.deadAfterMs = options.deadAfterMs ?? 6000;
    this.staleAfterMs = options.staleAfterMs ?? this.deadAfterMs / 2;
    this.forgetAfterMs = options.forgetAfterMs ?? 5 * 60_000;
    this.creationGraceMs = options.creationGraceMs ?? 5000;
    this.reservationTtlMs = options.reservationTtlMs ?? 1000;
    this.holdMs = options.holdMs ?? 15_000;
  }

  get(serverId: string): ServerEntry | undefined {
    return this.servers.get(serverId);
  }

  all(): ServerEntry[] {
    return [...this.servers.values()];
  }

  /** A server announces itself (startup, or re-registration). */
  register(identity: ServerIdentity): ServerEntry {
    const existing = this.servers.get(identity.serverId);
    const entry: ServerEntry = {
      ...identity,
      state: "starting",
      instances: new Map(),
      tickP95Ms: 0,
      cpu: 0,
      eventLoopUtilization: 0,
      // Re-registering after a crash: old instances are gone.
      lastHeartbeat: this.now(),
    };
    if (existing?.state === "draining") entry.state = "draining";
    this.servers.set(identity.serverId, entry);
    return entry;
  }

  /**
   * Applies a heartbeat. Unknown servers are registered on the spot. Returns
   * the state the orchestrator wants the server in.
   */
  heartbeat(report: HeartbeatBody): ServerState {
    const now = this.now();
    const entry = this.servers.get(report.serverId) ?? this.register(report);
    const wasDraining = entry.state === "draining";
    Object.assign(entry, {
      url: report.url,
      internalUrl: report.internalUrl,
      region: report.region,
      capacity: report.capacity,
      tickP95Ms: report.tickP95Ms,
      cpu: report.cpu,
      eventLoopUtilization: report.eventLoopUtilization,
      lastHeartbeat: now,
      // A drain requested here sticks until the server reports it.
      state: wasDraining && report.state === "ready" ? "draining" : report.state,
    });

    const reported = new Map(report.instances.map((i) => [i.id, i]));
    for (const [id, known] of entry.instances) {
      if (reported.has(id)) continue;
      const justCreated =
        known.createdAt !== undefined && now - known.createdAt < this.creationGraceMs;
      if (!justCreated) entry.instances.delete(id);
    }
    for (const instance of report.instances) {
      const known = entry.instances.get(instance.id);
      entry.instances.set(instance.id, {
        ...instance,
        serverId: entry.serverId,
        createdAt: known?.createdAt,
        // The heartbeat already counts players who arrived before it.
        reservations: (known?.reservations ?? []).filter(
          (at) => now - at < this.reservationTtlMs,
        ),
      });
    }
    return entry.state;
  }

  /** Marks servers without recent heartbeats as dead; forgets old ones. */
  sweep(): ServerEntry[] {
    const now = this.now();
    const died: ServerEntry[] = [];
    for (const entry of this.servers.values()) {
      const silentFor = now - entry.lastHeartbeat;
      if (entry.state === "dead" || entry.state === "stopped") {
        if (silentFor > this.forgetAfterMs) this.servers.delete(entry.serverId);
        continue;
      }
      if (silentFor > this.deadAfterMs) {
        entry.state = "dead";
        entry.instances.clear();
        died.push(entry);
      }
    }
    return died;
  }

  /** Ready and heard from recently: may receive new players. */
  acceptsPlayers(entry: ServerEntry): boolean {
    return entry.state === "ready" && this.now() - entry.lastHeartbeat <= this.staleAfterMs;
  }

  /** Stops new allocations to a server; it learns it with the next heartbeat. */
  drain(serverId: string): ServerEntry | undefined {
    const entry = this.servers.get(serverId);
    if (entry && (entry.state === "ready" || entry.state === "starting")) {
      entry.state = "draining";
    }
    return entry;
  }

  addInstance(serverId: string, instance: Omit<InstanceEntry, "serverId" | "createdAt" | "reservations">): InstanceEntry {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`Unknown server ${serverId}`);
    const added: InstanceEntry = {
      ...instance,
      serverId,
      createdAt: this.now(),
      reservations: [],
    };
    entry.instances.set(instance.id, added);
    return added;
  }

  /** Counts a player who was just sent to an instance. */
  reserve(instance: InstanceEntry): void {
    const now = this.now();
    instance.reservations.push(now);
    const server = this.servers.get(instance.serverId);
    if (server) server.lastReservedAt = now;
  }

  /**
   * A player was sent to this server recently and may not have arrived yet.
   * The heartbeat response passes this on as `hold`: with Agones, the server
   * then stays Allocated, so the autoscaler can't remove it under the
   * player's feet.
   */
  holds(entry: ServerEntry): boolean {
    return entry.lastReservedAt !== undefined && this.now() - entry.lastReservedAt < this.holdMs;
  }

  /** Players inside plus players on their way. */
  load(instance: InstanceEntry): number {
    const now = this.now();
    // Unconfirmed reservations stop counting once the ticket would expire.
    return instance.players + instance.reservations.filter((at) => now - at < 30_000).length;
  }

  serverPlayers(entry: ServerEntry): number {
    let sum = 0;
    for (const instance of entry.instances.values()) sum += this.load(instance);
    return sum;
  }

  instances(): InstanceEntry[] {
    return this.all().flatMap((s) => [...s.instances.values()]);
  }

  view(entry: ServerEntry): ServerView {
    return {
      serverId: entry.serverId,
      url: entry.url,
      internalUrl: entry.internalUrl,
      region: entry.region,
      capacity: entry.capacity,
      state: entry.state,
      players: this.serverPlayers(entry),
      instances: [...entry.instances.values()].map(
        ({ id, zoneId, ownerPartyId, boundPortalKey, players, state }) => ({
          id,
          zoneId,
          ownerPartyId,
          boundPortalKey,
          players,
          state,
        }),
      ),
      tickP95Ms: entry.tickP95Ms,
      cpu: entry.cpu,
      eventLoopUtilization: entry.eventLoopUtilization,
      lastHeartbeatAgoMs: this.now() - entry.lastHeartbeat,
    };
  }

  /** Restores servers from a mirror after a restart (until heartbeats arrive). */
  restore(views: ServerView[]): void {
    const now = this.now();
    for (const view of views) {
      if (this.servers.has(view.serverId) || view.state === "dead") continue;
      this.servers.set(view.serverId, {
        serverId: view.serverId,
        url: view.url,
        internalUrl: view.internalUrl,
        region: view.region,
        capacity: view.capacity,
        state: view.state,
        tickP95Ms: view.tickP95Ms,
        cpu: view.cpu,
        eventLoopUtilization: view.eventLoopUtilization,
        // Give the server a full heartbeat window to confirm it is alive.
        lastHeartbeat: now,
        instances: new Map(
          view.instances.map((i) => [
            i.id,
            { ...i, serverId: view.serverId, reservations: [] },
          ]),
        ),
      });
    }
  }
}
