import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHttpClient, orchestratorApi } from "@mmoexile/contracts";
import { newCharacter, startRealm, TestClient, until, type Realm } from "./harness.js";

let realm: Realm;
let call: ReturnType<typeof createHttpClient>;

beforeAll(async () => {
  realm = await startRealm({ servers: ["s1", "s2", "s3"] });
  call = createHttpClient({ baseUrl: realm.orchestratorUrl });
  await until(
    () => realm.orchestrator.registry.all().filter((s) => s.state === "ready").length === 3,
    5000,
    "fleet ready",
  );
});

afterAll(async () => {
  await realm.stop();
});

describe("Allocation across the fleet", () => {
  it("a ticket admits the character into exactly the allocated instance", async () => {
    const c = await newCharacter();
    const allocation = await call(orchestratorApi.allocate, { zoneId: "golem_dungeon", ...c });
    expect(allocation.url).toBe(realm.orchestrator.registry.get(allocation.serverId)!.url);

    const client = new TestClient(allocation.url, allocation.ticket);
    const welcome = await client.welcome();
    expect(welcome.instanceId).toBe(allocation.instanceId);
    expect(realm.servers.get(allocation.serverId)!.host.getInstance(allocation.instanceId)?.players.has(c.characterId)).toBe(true);
    client.close();
  });

  it("public zones fill one shard before opening another", async () => {
    const first = await call(orchestratorApi.allocate, { zoneId: "overworld", characterId: "p1", accountId: "a" });
    const second = await call(orchestratorApi.allocate, { zoneId: "overworld", characterId: "p2", accountId: "a" });
    expect(second.instanceId).toBe(first.instanceId);
  });

  it("spreads 60 dungeon instances evenly (±20%) over 3 servers", async () => {
    const counts: Record<string, number> = { s1: 0, s2: 0, s3: 0 };
    const before = new Map(
      ["s1", "s2", "s3"].map((id) => [id, realm.servers.get(id)!.host.getAllInstances().length]),
    );
    for (let i = 0; i < 60; i++) {
      const { serverId } = await call(orchestratorApi.allocate, {
        zoneId: "golem_dungeon",
        characterId: `spread-${i}`,
        accountId: "a",
      });
      counts[serverId]++;
    }
    for (const id of ["s1", "s2", "s3"]) {
      expect(counts[id]).toBeGreaterThanOrEqual(16);
      expect(counts[id]).toBeLessThanOrEqual(24);
      // The instances really exist on the servers, not just in the registry.
      const now = realm.servers.get(id)!.host.getAllInstances().length;
      expect(now - before.get(id)!).toBe(counts[id]);
    }
  });
});
