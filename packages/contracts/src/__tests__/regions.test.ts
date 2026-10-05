import { describe, it, expect } from "vitest";
import { fastestRegion, measurePing, parseRegions, RegionId, warmMedian } from "../index.js";

describe("region IDs", () => {
  it("allow lower-case letters, digits and dashes only", () => {
    for (const id of ["eu", "us-east-1", "local"]) expect(RegionId.safeParse(id).success).toBe(true);
    for (const id of ["", "EU", "eu west", "eu_west", "eu/1"]) expect(RegionId.safeParse(id).success).toBe(false);
  });
});

describe("parseRegions", () => {
  it("reads id=Name=pingUrl entries", () => {
    expect(parseRegions("eu=Europe=http://localhost:7100/ping, us=North America=http://h/ping?a=b")).toEqual([
      { id: "eu", name: "Europe", pingUrl: "http://localhost:7100/ping" },
      { id: "us", name: "North America", pingUrl: "http://h/ping?a=b" },
    ]);
  });

  it("rejects malformed, empty and duplicate entries", () => {
    expect(() => parseRegions("")).toThrow(/at least one/);
    expect(() => parseRegions("eu=Europe")).toThrow(/Invalid region/);
    expect(() => parseRegions("EU=Europe=http://x/ping")).toThrow(/Invalid region/);
    expect(() => parseRegions("eu=A=http://a/ping,eu=B=http://b/ping")).toThrow(/twice/);
  });
});

describe("region pings", () => {
  it("takes the median of the warm samples", () => {
    expect(warmMedian([300, 40, 42, 41, 90])).toBe(41.5); // 300 ms was connection setup
    expect(warmMedian([300, 40, 42, 90])).toBe(42);
    expect(warmMedian([300])).toBeUndefined();
  });

  it("measures a URL five times, or reports it unreachable", async () => {
    let clock = 0;
    const durations = [120, 40, 44, 41, 43];
    let calls = 0;
    const fetchOk = (async () => {
      clock += durations[calls++];
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await measurePing("http://eu/ping", { fetch: fetchOk, now: () => clock })).toBe(42);
    expect(calls).toBe(5);

    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await measurePing("http://us/ping", { fetch: failing })).toBeUndefined();
  });

  it("preselects the fastest reachable region", () => {
    const regions = [
      { id: "eu", name: "Europe", pingUrl: "", pingMs: 12 },
      { id: "us", name: "North America", pingUrl: "", pingMs: 95 },
      { id: "ap", name: "Asia", pingUrl: "", pingMs: undefined },
    ];
    expect(fastestRegion(regions)).toBe("eu");
    expect(fastestRegion(regions, ["eu"])).toBe("us");
    expect(fastestRegion([regions[2]])).toBeUndefined();
  });
});
