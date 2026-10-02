import { describe, it, expect } from "vitest";
import { createLogger } from "@mmoexile/service-kit";
import { InstanceHost } from "../cluster/index.js";
import { buildInternalApi } from "../internalApi.js";

describe("internal API", () => {
  it("creates instances with the orchestrator's ID, unless draining", async () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    let accepting = true;
    const app = buildInternalApi({
      logger: createLogger("test", "silent"),
      host,
      acceptsInstances: () => accepting,
    });
    const create = (payload: object) =>
      app.inject({ method: "POST", url: "/internal/instances", payload });

    const ok = await create({ instanceId: "golem_dungeon:abcdef", zoneId: "golem_dungeon", ownerPartyId: "p1" });
    expect(ok.json()).toEqual({ instanceId: "golem_dungeon:abcdef" });
    expect(host.getInstance("golem_dungeon:abcdef")?.ownerPartyId).toBe("p1");

    expect((await create({ instanceId: "golem_dungeon:abcdef", zoneId: "golem_dungeon" })).statusCode).toBe(409);
    expect((await create({ instanceId: "moon:1", zoneId: "moon" })).statusCode).toBe(400);
    accepting = false;
    expect((await create({ instanceId: "nexus:000001", zoneId: "nexus" })).statusCode).toBe(409);
    await app.close();
    host.stop();
  });
});
