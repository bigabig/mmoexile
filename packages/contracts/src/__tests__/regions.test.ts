import { describe, it, expect } from "vitest";
import { parseRegions, RegionId } from "../index.js";

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
