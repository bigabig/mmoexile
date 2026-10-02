import {
  Counter,
  createMetrics,
  FAST_DURATION_BUCKETS,
  Gauge,
  Histogram,
  SLOW_DURATION_BUCKETS,
  type Registry,
} from "@mmoexile/service-kit";
import type { InstanceHost } from "./cluster/index.js";

/** Prometheus metrics of one instance server, served on the internal port. */
export class InstanceServerMetrics {
  readonly registry: Registry;
  readonly tickDuration: Histogram;
  readonly handoffDuration: Histogram<"kind">;
  readonly ticketRejections: Counter<"reason">;
  readonly leaseConflicts: Counter;
  readonly fencedWrites: Counter;

  constructor(serverId: string, host: InstanceHost) {
    this.registry = createMetrics("instance-server");
    this.registry.setDefaultLabels({ service: "instance-server", server: serverId });
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
      help: "Live instances on this server, by zone",
      labelNames: ["zone"],
      registers,
      collect() {
        this.reset();
        for (const instance of host.getAllInstances()) this.inc({ zone: instance.zone.id });
      },
    });
    this.tickDuration = new Histogram({
      name: "mmoexile_tick_duration_seconds",
      help: "Duration of one simulation tick (any instance); the budget is 33 ms",
      buckets: FAST_DURATION_BUCKETS,
      registers,
    });
    this.handoffDuration = new Histogram({
      name: "mmoexile_handoff_duration_seconds",
      help: "From ticket issue to admission here (login or zone change incl. reconnect)",
      labelNames: ["kind"],
      buckets: SLOW_DURATION_BUCKETS,
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
  }
}
