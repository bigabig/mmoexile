import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { accountApi, createHttpClient } from "@mmoexile/contracts";
import { Health, Position } from "@mmoexile/game-core";
import { startRealm, TestClient, until, type Realm } from "./harness.js";

let realm: Realm;

beforeAll(async () => {
  realm = await startRealm({ servers: ["s1", "s2"] });
  await until(
    () => realm.orchestrator.registry.all().filter((s) => s.state === "ready").length === 2,
    5000,
    "fleet ready",
  );
});

afterAll(async () => {
  await realm.stop();
});

/** The server currently simulating a character. */
const serverOf = (characterId: string) =>
  [...realm.servers.values()].find((s) => s.lifecycle.get(characterId));

describe("A player's journey through the orchestrator", () => {
  it("logs in via account-api and changes zones with orchestrator tickets", async () => {
    let token: string | undefined;
    const api = createHttpClient({ baseUrl: realm.accountApiUrl, token: () => token });
    const login = await api(accountApi.guestLogin, { nickname: "Journey" });
    token = login.sessionToken;
    const { character } = await api(accountApi.createCharacter, { classId: "knight" });

    // First ticket: account-api asks the orchestrator for a nexus slot
    const play = await api(accountApi.play, { characterId: character.id });
    const client = new TestClient(play.url, play.ticket);
    const nexus = await client.welcome();
    expect(nexus.zoneId).toBe("nexus");
    const known = realm.orchestrator.registry.instances().map((i) => i.id);
    expect(known).toContain(nexus.instanceId);

    // Walk onto the nexus portal with changed state and use it
    const server = serverOf(character.id)!;
    const instance = server.host.getInstanceForPlayer(character.id)!;
    const eid = instance.world.uuidToEid.get(character.id)!;
    Health.current[eid] = 77;
    Position.x[eid] = 20;
    Position.y[eid] = 9.5;
    client.send({ type: "c2s_interact" });

    // Second ticket: the source server asks the orchestrator
    const overworld = await client.welcome(2);
    expect(overworld.zoneId).toBe("overworld");
    expect(overworld.playerState.hp).toBe(77);
    const target = realm.orchestrator.registry
      .instances()
      .find((i) => i.id === overworld.instanceId);
    expect(target).toBeDefined();
    expect(serverOf(character.id)!.host.getInstanceForPlayer(character.id)?.id).toBe(
      overworld.instanceId,
    );
    client.close();
  });
});
