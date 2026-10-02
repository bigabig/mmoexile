import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { DEV_TICKET_PRIVATE_KEY, signTicket, ticketSigningKey } from "@mmoexile/auth";
import { createHttpClient, orchestratorApi } from "@mmoexile/contracts";
import { Health } from "@mmoexile/game-core";
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

const setHp = (serverId: string, characterId: string, hp: number) => {
  const server = realm.servers.get(serverId)!;
  const instance = server.host.getInstanceForPlayer(characterId)!;
  Health.current[instance.world.uuidToEid.get(characterId)!] = hp;
};

describe("Draining a server", () => {
  it("moves all hub players to other servers with their state, then stops", async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => newCharacter()));
    const clients = await Promise.all(
      players.map(async (c) => {
        const allocation = await call(orchestratorApi.allocate, { zoneId: "nexus", ...c });
        const client = new TestClient(allocation.url, allocation.ticket);
        await client.welcome();
        return { ...c, client, serverId: allocation.serverId };
      }),
    );
    // Fill first: the whole group shares one nexus shard
    const drained = clients[0].serverId;
    expect(clients.every((c) => c.serverId === drained)).toBe(true);
    clients.forEach((c, i) => setHp(drained, c.characterId, 40 + i));

    const response = await call(orchestratorApi.drain, undefined, {
      path: `/servers/${drained}/drain`,
    });
    expect(response.state).toBe("draining");

    const drainedUrl = realm.orchestrator.registry.get(drained)!.url;
    for (const [i, c] of clients.entries()) {
      const welcome = await c.client.welcome(2);
      expect(welcome.zoneId).toBe("nexus");
      expect(welcome.playerState.hp).toBe(40 + i);
      expect(c.client.url).not.toBe(drainedUrl);
    }

    // Empty → stopped; nothing is placed there any more
    await until(() => realm.orchestrator.registry.get(drained)?.state === "stopped", 10_000, "stopped");
    realm.servers.delete(drained);
    const next = await call(orchestratorApi.allocate, { zoneId: "golem_dungeon", characterId: "x", accountId: "a" });
    expect(next.serverId).not.toBe(drained);
    clients.forEach((c) => c.client.close());
  });

  it("lets a dungeon run finish until the drain timeout, then moves the player", async () => {
    const server = await realm.addServer("s-dungeon", { DRAIN_TIMEOUT_SEC: "1" });
    await until(() => realm.orchestrator.registry.get("s-dungeon")?.state === "ready", 5000, "ready");
    const dungeon = server.host.createInstance("golem_dungeon");

    const c = await newCharacter();
    const ticket = await signTicket(
      {
        ...c,
        ticketId: randomUUID(),
        zoneId: "golem_dungeon",
        instanceId: dungeon.id,
        targetServerId: "s-dungeon",
      },
      await ticketSigningKey(DEV_TICKET_PRIVATE_KEY),
    );
    const client = new TestClient(realm.orchestrator.registry.get("s-dungeon")!.url, ticket);
    expect((await client.welcome()).instanceId).toBe(dungeon.id);
    setHp("s-dungeon", c.characterId, 33);

    const draining = server.drain();
    await new Promise((r) => setTimeout(r, 500));
    expect(server.host.getInstanceForPlayer(c.characterId)?.id).toBe(dungeon.id); // still playing

    const moved = await client.welcome(2);
    expect(moved.zoneId).toBe("nexus");
    expect(moved.playerState.hp).toBe(33);
    await draining;
    realm.servers.delete("s-dungeon");
    await server.stop();
    client.close();
  });
});
