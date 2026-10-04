import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { accountApi, createHttpClient, HttpError } from "@mmoexile/contracts";
import { startRealm, TestClient, until, type Realm } from "./harness.js";

/**
 * Two regions in one realm: EU (two servers) and US (one server). Chat and
 * parties are global, hubs are per region, and a party's dungeon runs in
 * the leader's region.
 */
let realm: Realm;

beforeAll(async () => {
  realm = await startRealm({ servers: ["eu1@eu", "eu2@eu", "us1@us"], regions: ["eu", "us"] });
  await until(
    () => realm.orchestrator.registry.all().filter((s) => s.state === "ready").length === 3,
    5000,
    "fleet ready",
  );
});

afterAll(async () => {
  await realm.stop();
});

const serverOf = (characterId: string) =>
  [...realm.servers.entries()].find(([, s]) => s.lifecycle.get(characterId));
const regionOf = (characterId: string) =>
  realm.orchestrator.registry.get(serverOf(characterId)![0])!.region;

/** Logs a new guest in through account-api, in a region. */
async function login(nickname: string, region: string) {
  let token: string | undefined;
  const api = createHttpClient({ baseUrl: realm.accountApiUrl, token: () => token });
  token = (await api(accountApi.guestLogin, { nickname })).sessionToken;
  const { character } = await api(accountApi.createCharacter, { classId: "knight" });
  const play = () => api(accountApi.play, { characterId: character.id, region });
  const ticket = await play();
  const client = new TestClient(ticket.url, ticket.ticket);
  const welcome = await client.welcome();
  return { id: character.id, client, welcome, play };
}

describe("Regions", () => {
  it("gives every player hubs in their region, and runs a party's dungeon in the leader's region", async () => {
    const anna = await login("Anna", "eu");
    const ben = await login("Ben", "us");

    // Hubs per region: separate nexus instances on servers of each region
    expect(regionOf(anna.id)).toBe("eu");
    expect(regionOf(ben.id)).toBe("us");
    expect(ben.welcome.instanceId).not.toBe(anna.welcome.instanceId);
    const usNexus = ben.welcome.instanceId;

    // Parties are global: Anna (EU) invites Ben (US) and leads
    expect((await realm.parties.invite(anna.id, ben.id)).ok).toBe(true);
    expect((await realm.parties.accept(ben.id)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100)); // party.updated reaches the servers

    // Ben enters first: the dungeon is created in Anna's region (EU)
    expect(await serverOf(ben.id)![1].lifecycle.handOff(ben.id, "golem_dungeon")).toBe(true);
    const benDungeon = await ben.client.welcome(2);
    expect(benDungeon.zoneId).toBe("golem_dungeon");
    expect(regionOf(ben.id)).toBe("eu");

    // Anna joins the same instance
    expect(await serverOf(anna.id)![1].lifecycle.handOff(anna.id, "golem_dungeon")).toBe(true);
    expect((await anna.client.welcome(2)).instanceId).toBe(benDungeon.instanceId);

    // Ben leaves the dungeon: back to a hub in his own region
    expect(await serverOf(ben.id)![1].lifecycle.handOff(ben.id, "nexus")).toBe(true);
    const back = await ben.client.welcome(3);
    expect(regionOf(ben.id)).toBe("us");
    expect(back.instanceId).toBe(usNexus);

    anna.client.close();
    ben.client.close();
  });

  it("answers region_unavailable when a region has no capacity, without touching other regions", async () => {
    const cleo = await login("Cleo", "us");
    cleo.client.close();
    realm.orchestrator.registry.drain("us1");

    const err = await cleo.play().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 503, reason: "region_unavailable" });

    const dora = await login("Dora", "eu");
    expect(regionOf(dora.id)).toBe("eu");
    dora.client.close();
  });
});
