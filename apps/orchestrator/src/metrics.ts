import {
  Counter,
  createMetrics,
  Gauge,
  Histogram,
  SLOW_DURATION_BUCKETS,
  type Registry as MetricsRegistry,
} from "@mmoexile/service-kit";
import type { Registry } from "./Registry.js";

/**
 * Orchestrator metrics. The per-server gauges mirror the heartbeats, so one
 * scrape of the orchestrator shows the whole fleet.
 */
export class OrchestratorMetrics {
  readonly registry: MetricsRegistry;
  readonly allocationDuration: Histogram<"created">;
  readonly allocationFailures: Counter<"status">;

  constructor(fleet: Registry) {
    this.registry = createMetrics("orchestrator");
    const registers = [this.registry];

    this.allocationDuration = new Histogram({
      name: "mmoexile_allocation_duration_seconds",
      help: "Time to answer /allocate (created: a new instance was started)",
      labelNames: ["created"],
      buckets: SLOW_DURATION_BUCKETS,
      registers,
    });
    this.allocationFailures = new Counter({
      name: "mmoexile_allocation_failures_total",
      help: "Allocations that failed, by HTTP status",
      labelNames: ["status"],
      registers,
    });
    new Gauge({
      name: "mmoexile_fleet_servers",
      help: "Instance servers by state",
      labelNames: ["state"],
      registers,
      collect() {
        this.reset();
        for (const s of fleet.all()) this.inc({ state: s.state });
      },
    });
    new Gauge({
      name: "mmoexile_fleet_server_players",
      help: "Players per instance server (incl. players on their way)",
      labelNames: ["server"],
      registers,
      collect() {
        this.reset();
        for (const s of fleet.all()) this.set({ server: s.serverId }, fleet.serverPlayers(s));
      },
    });
    new Gauge({
      name: "mmoexile_fleet_server_instances",
      help: "Instances per instance server",
      labelNames: ["server"],
      registers,
      collect() {
        this.reset();
        for (const s of fleet.all()) this.set({ server: s.serverId }, s.instances.size);
      },
    });
    new Gauge({
      name: "mmoexile_fleet_server_event_loop_utilization",
      help: "Event loop utilization per instance server (0..1), as last reported",
      labelNames: ["server"],
      registers,
      collect() {
        this.reset();
        for (const s of fleet.all()) this.set({ server: s.serverId }, s.eventLoopUtilization);
      },
    });
    new Gauge({
      name: "mmoexile_fleet_server_tick_p95_seconds",
      help: "Tick p95 per instance server, as last reported",
      labelNames: ["server"],
      registers,
      collect() {
        this.reset();
        for (const s of fleet.all()) this.set({ server: s.serverId }, s.tickP95Ms / 1000);
      },
    });
  }
}
