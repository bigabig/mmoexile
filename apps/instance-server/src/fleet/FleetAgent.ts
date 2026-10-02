import { performance } from "node:perf_hooks";
import {
  createHttpClient,
  orchestratorApi,
  type HeartbeatBody,
  type InstanceReport,
  type ServerIdentity,
  type ServerState,
} from "@mmoexile/contracts";
import type { InstanceHost } from "../cluster/index.js";

/** The lifecycle states a server reports about itself. */
export type OwnState = Exclude<ServerState, "dead">;

export interface FleetAgentDeps {
  identity: ServerIdentity;
  orchestratorUrl: string;
  host: InstanceHost;
  intervalMs?: number;
  /** The orchestrator asked this server to drain. */
  onDrainRequested?: () => void;
  log?: (level: "info" | "warn", message: string, extra?: Record<string, unknown>) => void;
  fetch?: typeof fetch;
}

/**
 * This server's link to the orchestrator: registers on startup, then reports
 * its state and instances every interval (and right away when instances are
 * created or closed). If the orchestrator is down, players keep playing;
 * only new allocations wait for it.
 */
export class FleetAgent {
  private state: OwnState = "starting";
  private timer: NodeJS.Timeout | undefined;
  private soon: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private orchestratorReachable = true;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();
  private lastElu = performance.eventLoopUtilization();
  private readonly call;
  private readonly log: NonNullable<FleetAgentDeps["log"]>;

  constructor(private readonly deps: FleetAgentDeps) {
    this.call = createHttpClient({ baseUrl: deps.orchestratorUrl, fetch: deps.fetch });
    this.log = deps.log ?? (() => {});
  }

  get currentState(): OwnState {
    return this.state;
  }

  get intervalMs(): number {
    return this.deps.intervalMs ?? 2000;
  }

  /** Registers, enters `ready` and starts heartbeats. */
  async start(): Promise<void> {
    try {
      await this.call(orchestratorApi.register, this.deps.identity);
      this.log("info", "Registered with the orchestrator", { orchestrator: this.deps.orchestratorUrl });
    } catch (err) {
      // Heartbeats register implicitly once the orchestrator is back.
      this.log("warn", "Orchestrator unreachable at startup", { err: String(err) });
    }
    this.state = "ready";
    await this.report();
    this.timer = setInterval(() => void this.report(), this.intervalMs);
    this.timer.unref();
  }

  async setState(state: OwnState): Promise<void> {
    if (this.state === state) return;
    this.state = state;
    await this.report();
  }

  /** Report soon (instance created or closed), coalescing bursts. */
  reportSoon(): void {
    if (this.soon || !this.timer) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      void this.report();
    }, 50);
    this.soon.unref();
  }

  /**
   * Stops reporting without a goodbye, as if the process died. Used to
   * simulate crashes in tests.
   */
  halt(): void {
    clearInterval(this.timer);
    clearTimeout(this.soon);
    this.timer = undefined;
  }

  /** Sends a final `stopped` report and stops reporting. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    clearTimeout(this.soon);
    this.timer = undefined;
    await this.inFlight;
    this.state = "stopped";
    await this.send();
  }

  private report(): Promise<void> {
    // One heartbeat at a time; a slow orchestrator must not pile them up.
    this.inFlight ??= this.send().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async send(): Promise<void> {
    const body: HeartbeatBody = {
      ...this.deps.identity,
      state: this.state,
      instances: this.instanceReports(),
      tickP95Ms: this.deps.host.tickStats.takeP95(),
      cpu: this.cpuSinceLastReport(),
      eventLoopUtilization: this.eluSinceLastReport(),
    };
    try {
      const { desiredState } = await this.call(orchestratorApi.heartbeat, body, {
        path: `/servers/${encodeURIComponent(body.serverId)}/heartbeat`,
      });
      if (!this.orchestratorReachable) {
        this.orchestratorReachable = true;
        this.log("info", "Orchestrator reachable again");
      }
      if (desiredState === "draining" && this.state === "ready") {
        this.deps.onDrainRequested?.();
      }
    } catch (err) {
      if (this.orchestratorReachable) {
        this.orchestratorReachable = false;
        this.log("warn", "Heartbeat failed", { err: String(err) });
      }
    }
  }

  private instanceReports(): InstanceReport[] {
    return this.deps.host.getAllInstances().map((i) => ({
      id: i.id,
      zoneId: i.zone.id,
      ownerPartyId: i.ownerPartyId,
      boundPortalKey: i.boundPortalKey,
      players: i.players.size,
      state: i.state,
    }));
  }

  private eluSinceLastReport(): number {
    const now = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(now, this.lastElu);
    this.lastElu = now;
    return Math.min(1, Math.max(0, delta.utilization));
  }

  private cpuSinceLastReport(): number {
    const now = performance.now();
    const usage = process.cpuUsage(this.lastCpu);
    const elapsedMicros = (now - this.lastCpuAt) * 1000;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    return elapsedMicros > 0 ? (usage.user + usage.system) / elapsedMicros : 0;
  }
}
