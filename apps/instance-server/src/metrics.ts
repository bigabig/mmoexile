import { performance } from "node:perf_hooks";
import {
  Counter,
  createMetrics,
  FAST_DURATION_BUCKETS,
  Gauge,
  Histogram,
  type Registry,
} from "@mmoexile/service-kit";
import type { InstanceHost } from "./cluster/index.js";

/** Prometheus metrics of one instance server, served on the internal port. */
export class InstanceServerMetrics {
  readonly registry: Registry;
  readonly tickDuration: Histogram;
  readonly tickInterval: Histogram;
  readonly handoffDuration: Histogram<"kind" | "from_region" | "to_region">;
  readonly ticketRejections: Counter<"reason">;
  readonly leaseConflicts: Counter;
  readonly fencedWrites: Counter;
  readonly saveFailures: Counter<"kind" | "retrying">;
  readonly writeDuration: Histogram;

  constructor(
    serverId: string,
    region: string,
    host: InstanceHost,
    persistence?: { readonly waitingForDatabase: number },
  ) {
    this.registry = createMetrics("instance-server");
    this.registry.setDefaultLabels({ service: "instance-server", server: serverId, region });
    const registers = [this.registry];

    new Gauge({
      name: "mmoexile_players",
      help: "Players on this server",
      registers,
      collect() {
        this.set(host.getAllInstances().reduce((sum, i) => sum + i.players.size, 0));
      },
    });
    new Gauge({
      name: "mmoexile_instances",
      help: "Live instances on this server, by zone and state (only running ones tick)",
      labelNames: ["zone", "state"],
      registers,
      collect() {
        this.reset();
        for (const instance of host.getAllInstances()) {
          this.inc({ zone: instance.zone.id, state: instance.state });
        }
      },
    });
    let lastElu = performance.eventLoopUtilization();
    new Gauge({
      name: "mmoexile_event_loop_utilization",
      help: "Share of time the event loop was busy since the last scrape (0..1)",
      registers,
      collect() {
        const now = performance.eventLoopUtilization();
        this.set(performance.eventLoopUtilization(now, lastElu).utilization);
        lastElu = now;
      },
    });
    this.tickDuration = new Histogram({
      name: "mmoexile_tick_duration_seconds",
      help: "Duration of one simulation tick (any instance); the budget is 33 ms",
      buckets: FAST_DURATION_BUCKETS,
      registers,
    });
    this.tickInterval = new Histogram({
      name: "mmoexile_tick_interval_seconds",
      help: "Time between two ticks of the same instance; 0.033 when the server keeps up",
      buckets: [0.03, 0.034, 0.036, 0.04, 0.05, 0.066, 0.1, 0.2, 0.5],
      registers,
    });
    this.handoffDuration = new Histogram({
      name: "mmoexile_handoff_duration_seconds",
      help:
        "From ticket issue to admission here (login, or zone_change: any handoff from another server, incl. reconnect). " +
        "from_region is the region of the server the player left (none on login), to_region this server's",
      labelNames: ["kind", "from_region", "to_region"],
      // Finer than SLOW_DURATION_BUCKETS between 50 ms and 1 s, where
      // cross-region handoffs land.
      buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 2.5, 5, 10, 30],
      registers,
    });
    this.ticketRejections = new Counter({
      name: "mmoexile_ticket_rejections_total",
      help: "Connections refused at admission, by reason",
      labelNames: ["reason"],
      registers,
    });
    this.leaseConflicts = new Counter({
      name: "mmoexile_lease_conflicts_total",
      help: "Admissions that found the character owned elsewhere (duplicate login)",
      registers,
    });
    this.fencedWrites = new Counter({
      name: "mmoexile_fenced_writes_total",
      help: "Character writes refused because another server took ownership",
      registers,
    });
    this.saveFailures = new Counter({
      name: "mmoexile_character_save_failures_total",
      help: "Failed character writes by kind (periodic, final, death); retrying=true while the database is unavailable",
      labelNames: ["kind", "retrying"],
      registers,
    });
    this.writeDuration = new Histogram({
      name: "mmoexile_character_write_seconds",
      help: "Duration of a character write (one fenced UPDATE): the database round trip as this server sees it",
      buckets: [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 5],
      registers,
    });
    new Gauge({
      name: "mmoexile_character_saves_pending",
      help: "Character writes waiting for the database",
      registers,
      collect() {
        this.set(persistence?.waitingForDatabase ?? 0);
      },
    });
  }
}
