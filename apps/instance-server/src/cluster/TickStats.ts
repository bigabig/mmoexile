/**
 * Collects tick durations across all instances of this process, for the
 * heartbeat (p95 since the last report) and for metrics.
 */
export class TickStats {
  private samples: number[] = [];

  constructor(private readonly maxSamples = 10_000) {}

  record(ms: number): void {
    if (this.samples.length < this.maxSamples) this.samples.push(ms);
  }

  /** p95 of the samples since the last call, then starts over. */
  takeP95(): number {
    const sorted = this.samples.sort((a, b) => a - b);
    this.samples = [];
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }
}
