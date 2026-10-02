import { collectDefaultMetrics, Registry } from "prom-client";

export {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

/**
 * A Prometheus registry for one service: process metrics (CPU, memory,
 * event loop lag) plus whatever the service adds. Every series carries the
 * service name; Prometheus adds the scrape target (`instance`) itself.
 */
export function createMetrics(service: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry, prefix: "mmoexile_" });
  return registry;
}

/** Histogram buckets for durations in seconds, from 1 ms to 1 s. */
export const FAST_DURATION_BUCKETS = [0.001, 0.002, 0.005, 0.01, 0.015, 0.02, 0.025, 0.033, 0.05, 0.1, 0.25, 0.5, 1];

/** Histogram buckets for durations in seconds, from 10 ms to 30 s. */
export const SLOW_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
