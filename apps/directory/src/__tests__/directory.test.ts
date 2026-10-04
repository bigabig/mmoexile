import { describe, it, expect } from "vitest";
import { directoryApi } from "@mmoexile/contracts";
import { createLogger } from "@mmoexile/service-kit";
import { buildDirectory } from "../app.js";
import { readConfig } from "../config.js";

const logger = createLogger("test", "silent");

describe("directory", () => {
  it("lists the realm with its regions, cacheable and readable cross-origin", async () => {
    const config = readConfig({
      REALM_NAME: "Standard",
      REGIONS: "eu=Europe=http://localhost:7100/ping,us=North America=http://localhost:7200/ping",
      CACHE_MAX_AGE_SEC: "30",
    });
    const app = buildDirectory({ config, logger });

    const res = await app.inject({ method: "GET", url: "/realms" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    const body = directoryApi.listRealms.response.parse(res.json());
    expect(body.realms).toEqual([
      {
        id: "standard",
        name: "Standard",
        accountApiUrl: "/api",
        regions: [
          { id: "eu", name: "Europe", pingUrl: "http://localhost:7100/ping" },
          { id: "us", name: "North America", pingUrl: "http://localhost:7200/ping" },
        ],
      },
    ]);
    await app.close();
  });

  it("answers pings itself for single-region dev setups", async () => {
    const config = readConfig({});
    expect(config.REGIONS.map((r) => r.id)).toEqual(["local"]);
    const app = buildDirectory({ config, logger });
    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("refuses to start with a malformed REGIONS setting", () => {
    expect(() => readConfig({ REGIONS: "Europe" })).toThrow();
  });
});
