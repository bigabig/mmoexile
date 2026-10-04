import type { RegionInfo } from "./directoryApi.js";

/**
 * Measuring a player's latency to each region, for the region selector
 * (browser) and the bots alike: ping the region's gateway a few times and
 * take the median of the warm samples. The first request also pays for DNS,
 * TCP and maybe TLS setup, so it is dropped.
 */

export const PING_SAMPLES = 5;

/** Median of all samples but the first (connection setup); undefined if none remain. */
export function warmMedian(samples: number[]): number | undefined {
  const warm = samples.slice(1).sort((a, b) => a - b);
  if (warm.length === 0) return undefined;
  const mid = Math.floor(warm.length / 2);
  return warm.length % 2 === 1 ? warm[mid] : (warm[mid - 1] + warm[mid]) / 2;
}

export interface PingOptions {
  samples?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per-request timeout; a region that doesn't answer in time is unreachable. */
  timeoutMs?: number;
}

/** Round-trip time to a ping URL in ms, or undefined if it is unreachable. */
export async function measurePing(url: string, options: PingOptions = {}): Promise<number | undefined> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  const samples: number[] = [];
  for (let i = 0; i < (options.samples ?? PING_SAMPLES); i++) {
    const started = now();
    try {
      const response = await doFetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
      });
      if (!response.ok) return undefined;
      await response.arrayBuffer(); // finish the response, keep the connection reusable
    } catch {
      return undefined;
    }
    samples.push(now() - started);
  }
  const median = warmMedian(samples);
  return median === undefined ? undefined : Math.round(median);
}

export interface RegionPing extends RegionInfo {
  /** Measured round trip in ms; undefined while unknown or if unreachable. */
  pingMs?: number;
}

/** Pings every region in parallel. */
export function measureRegions(regions: RegionInfo[], options: PingOptions = {}): Promise<RegionPing[]> {
  return Promise.all(
    regions.map(async (region) => ({ ...region, pingMs: await measurePing(region.pingUrl, options) })),
  );
}

/** The reachable region with the lowest ping, skipping `exclude` (e.g. known unavailable). */
export function fastestRegion(regions: RegionPing[], exclude: string[] = []): string | undefined {
  let best: RegionPing | undefined;
  for (const region of regions) {
    if (region.pingMs === undefined || exclude.includes(region.id)) continue;
    if (!best || region.pingMs < best.pingMs!) best = region;
  }
  return best?.id;
}
