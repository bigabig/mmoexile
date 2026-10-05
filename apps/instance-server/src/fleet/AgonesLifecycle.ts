import type { AgonesSdk, GameServerInfo } from "./AgonesSdk.js";

/** The GameServer states we switch between while running. */
export type AgonesState = "Ready" | "Allocated";

/**
 * Allocated while the server is in use, Ready only when it is empty and no
 * player is on the way: Agones scales down and replaces Ready servers only,
 * so a server with players (or about to get some) is never removed.
 */
export function desiredAgonesState(players: number, held: boolean): AgonesState {
  return players > 0 || held ? "Allocated" : "Ready";
}

export interface AgonesLifecycleDeps {
  sdk: AgonesSdk;
  /** Players currently on this server. */
  players: () => number;
  /** Max players (the `players` Counter's capacity, used by the FleetAutoscaler). */
  capacity: number;
  healthIntervalMs?: number;
  /** How long `hold()` keeps the server Allocated without players. */
  holdMs?: number;
  now?: () => number;
  log?: (level: "info" | "warn", message: string, extra?: Record<string, unknown>) => void;
}

/**
 * This server's side of the Agones lifecycle (LIFECYCLE=agones). The
 * orchestrator still decides where players go (D13); this only tells Agones
 * what it needs for scaling: alive (Health), in use or not (Allocated /
 * Ready), how full (the `players` Counter), and finished (Shutdown).
 */
export class AgonesLifecycle {
  private state: AgonesState | undefined;
  private count: number | undefined;
  private heldUntil = 0;
  private orchestratorHold = false;
  private stopped = false;
  private healthTimer: NodeJS.Timeout | undefined;
  private syncing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly log: NonNullable<AgonesLifecycleDeps["log"]>;

  constructor(private readonly deps: AgonesLifecycleDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  get currentState(): AgonesState | undefined {
    return this.state;
  }

  /** Once listening and registered: capacity, first state, health pings. */
  async start(): Promise<void> {
    await this.deps.sdk.setCounter("players", { capacity: this.deps.capacity });
    await this.sync();
    this.healthTimer = setInterval(() => {
      this.deps.sdk.health().catch((err) => this.log("warn", "Agones health ping failed", { err: String(err) }));
    }, this.deps.healthIntervalMs ?? 2000);
    this.healthTimer.unref();
  }

  /**
   * Keeps the server Allocated for a while although it has no players yet,
   * e.g. when the orchestrator creates an instance here for someone.
   */
  hold(): Promise<void> {
    this.heldUntil = Math.max(this.heldUntil, this.now() + (this.deps.holdMs ?? 15_000));
    return this.sync();
  }

  /**
   * The orchestrator's view, from each heartbeat: players are on their way
   * here. Called every heartbeat interval, so it also notices a `hold()`
   * that ran out.
   */
  setOrchestratorHold(hold: boolean): Promise<void> {
    this.orchestratorHold = hold;
    return this.sync();
  }

  /** Brings Agones in line with the player count and holds (one update at a time). */
  sync(): Promise<void> {
    this.syncing = this.syncing.then(() => this.apply()).catch((err) => {
      this.log("warn", "Agones update failed", { err: String(err) });
    });
    return this.syncing;
  }

  /**
   * Stops switching states: while draining, the server stays as it is until
   * it shuts down. Health pings go on (without them Agones would declare the
   * server Unhealthy and kill it mid-drain).
   */
  freeze(): void {
    this.stopped = true;
  }

  /** Done: Agones deletes this GameServer. */
  async shutdown(): Promise<void> {
    this.freeze();
    clearInterval(this.healthTimer);
    await this.syncing;
    await this.deps.sdk.shutdown();
  }

  private async apply(): Promise<void> {
    if (this.stopped) return;
    const players = this.deps.players();
    const held = this.orchestratorHold || this.now() < this.heldUntil;
    const target = desiredAgonesState(players, held);
    if (target !== this.state) {
      if (target === "Allocated") await this.deps.sdk.allocate();
      else await this.deps.sdk.ready();
      this.log("info", `Agones state ${target}`, { players, held });
      this.state = target;
    }
    if (players !== this.count) {
      await this.deps.sdk.setCounter("players", { count: players });
      this.count = players;
    }
  }
}

/**
 * The URL players connect to: the host port Agones assigned to the `game`
 * port, on `host` (the node's address unless given, e.g. localhost in kind).
 */
export function publicUrlFor(server: GameServerInfo, host?: string): string {
  const port = (server.ports.find((p) => p.name === "game") ?? server.ports[0])?.port;
  if (!port) throw new Error(`GameServer ${server.name} has no port`);
  return `ws://${host ?? server.address}:${port}/ws`;
}
