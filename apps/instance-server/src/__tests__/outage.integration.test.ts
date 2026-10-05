import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { databaseUrl, prisma, PrismaClient } from "@mmoexile/db";
import { Redis, RedisBroker } from "@mmoexile/messaging";
import { DEV_TICKET_PRIVATE_KEY, signTicket, ticketSigningKey } from "@mmoexile/auth";
import { redisKeys, type AllocateRequest } from "@mmoexile/contracts";
import { Health, Position } from "@mmoexile/game-core";
import { createLogger } from "@mmoexile/service-kit";
import { readConfig } from "../config.js";
import { createInstanceServer, type InstanceServer } from "../server.js";
import { InMemoryPartyDirectory } from "../party/PartyDirectory.js";
import type { ZoneAllocator } from "../fleet/ZoneAllocator.js";
import { freePort, newCharacter, TestClient, until } from "./harness.js";
import { OutageProxy } from "./outageProxy.js";

// Server a (nexus) reaches Postgres and Redis through proxies that can
// simulate an outage; server b (everything else) directly.

const ticketKey = await ticketSigningKey(DEV_TICKET_PRIVATE_KEY);
const allocator: ZoneAllocator = {
  async allocate(request: AllocateRequest) {
    const serverId = request.zoneId === "nexus" ? "a" : "b";
    const ticketId = randomUUID();
    const ticket = await signTicket({ ...request, ticketId, targetServerId: serverId }, ticketKey);
    return { serverId, instanceId: "", url: urls[serverId], ticket, ticketId };
  },
};

let urls: Record<"a" | "b", string>;
let serverA: InstanceServer;
let serverB: InstanceServer;
let dbProxy: OutageProxy;
let redisProxy: OutageProxy;
let dbA: PrismaClient;
/** Whether server a reaches the orchestrator (a region cut off from central) */
let centralReachableA = true;
let redis: Redis;
const closers: (() => Promise<unknown>)[] = [];

const LEASE_TTL_MS = 3000;

async function startServer(serverId: "a" | "b", port: number, db: PrismaClient, redisUrl: string, parties: InMemoryPartyDirectory) {
  const serverRedis = new Redis(redisUrl);
  const broker = new RedisBroker({ redis: serverRedis });
  closers.push(() => broker.close(), () => serverRedis.quit());
  const server = await createInstanceServer({
    config: readConfig({
      SERVER_ID: serverId,
      REDIS_URL: redisUrl,
      INTERNAL_PORT: "0",
      ORCHESTRATOR_URL: "",
      LEASE_TTL_MS: String(LEASE_TTL_MS),
      DATABASE_TIMEOUT_SEC: "1",
    }),
    logger: createLogger(`test-${serverId}`, "silent"),
    db,
    redis: serverRedis,
    broker,
    parties,
    allocator,
    centralReachable: serverId === "a" ? () => centralReachableA : undefined,
  });
  await server.listen(port);
  return server;
}

beforeAll(async () => {
  dbProxy = await OutageProxy.forUrl(process.env.DATABASE_URL!).start();
  redisProxy = await OutageProxy.forUrl(process.env.TEST_REDIS_URL!).start();
  // Short timeouts, so the test sees failures quickly
  dbA = new PrismaClient({
    datasourceUrl: databaseUrl({ DATABASE_URL: dbProxy.url(process.env.DATABASE_URL!), DATABASE_TIMEOUT_SEC: "1" }),
  });
  redis = new Redis(process.env.TEST_REDIS_URL!);
  const sharedBroker = new RedisBroker({ redis: new Redis(process.env.TEST_REDIS_URL!) });
  closers.push(() => sharedBroker.close());
  const parties = new InMemoryPartyDirectory(sharedBroker);
  const [pa, pb] = [await freePort(), await freePort()];
  urls = { a: `ws://127.0.0.1:${pa}/ws`, b: `ws://127.0.0.1:${pb}/ws` };
  serverA = await startServer("a", pa, dbA, redisProxy.url(process.env.TEST_REDIS_URL!), parties);
  serverB = await startServer("b", pb, prisma, process.env.TEST_REDIS_URL!, parties);
});

afterAll(async () => {
  dbProxy.resume();
  redisProxy.resume();
  await serverA.stop();
  await serverB.stop();
  for (const close of closers) await close();
  await redis.quit();
  await dbA.$disconnect();
  await dbProxy.close();
  await redisProxy.close();
});

const login = async () => {
  const c = await newCharacter();
  const client = new TestClient(urls.a, await signTicket({ ...c, zoneId: "nexus", targetServerId: "a", region: "eu" }, ticketKey));
  await client.next("s2c_welcome");
  const instance = serverA.host.getInstanceForPlayer(c.characterId)!;
  const eid = instance.world.uuidToEid.get(c.characterId)!;
  return { ...c, client, eid };
};

/** Stand on the nexus portal (to the overworld on b) and use it. */
const usePortal = (player: Awaited<ReturnType<typeof login>>) => {
  Position.x[player.eid] = 20;
  Position.y[player.eid] = 9.5;
  player.client.send({ type: "c2s_interact" });
};

const leaseHolder = async (characterId: string) => {
  const raw = await redis.get(redisKeys.lease(characterId));
  return raw ? JSON.parse(raw).serverId : null;
};
const hpInDatabase = async (characterId: string) =>
  (await prisma.character.findUnique({ where: { id: characterId } }))?.hp;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every test ends with the databases and central back, also when it fails
afterEach(() => {
  dbProxy.resume();
  redisProxy.resume();
  centralReachableA = true;
});

describe("Postgres outage", { timeout: 60_000 }, () => {
  it("a zone change waits for its save, then continues with the saved state", async () => {
    const player = await login();
    Health.current[player.eid] = 42;
    dbProxy.pause();
    usePortal(player);
    await sleep(2500); // the save times out and is retried meanwhile
    expect(player.client.packets.some((p) => p.type === "s2c_reconnect" || p.type === "s2c_kicked")).toBe(false);
    expect(serverA.persistence.available).toBe(false); // other zone changes are refused meanwhile
    dbProxy.resume();

    const reconnect = await player.client.next("s2c_reconnect", 15_000);
    player.client.close();
    const onB = new TestClient(reconnect.url, reconnect.ticket);
    const welcome = await onB.next("s2c_welcome");
    expect(welcome.playerState.hp).toBe(42);
    onB.close();
    await until(() => serverA.persistence.available, 15_000);
  });

  it("while it is known to be down, zone changes are refused and the player stays", async () => {
    const player = await login();
    dbProxy.pause();
    // A periodic save fails (they run every few seconds)
    await until(() => !serverA.persistence.available, 15_000);
    usePortal(player);
    await until(() => player.client.packets.some((p) => p.type === "s2c_chat" && /can't save right now/.test(p.text)));
    expect(serverA.lifecycle.get(player.characterId)).toBeDefined();

    dbProxy.resume();
    await until(() => serverA.persistence.available, 15_000);
    usePortal(player);
    const reconnect = await player.client.next("s2c_reconnect", 10_000);
    expect(reconnect.zoneId).toBe("overworld");
    player.client.close();
    expect(player.client.packets.some((p) => p.type === "s2c_kicked")).toBe(false);
  });

  it("leaving: the server keeps the lease until the final save is written", async () => {
    const player = await login();
    Health.current[player.eid] = 33;
    dbProxy.pause();
    player.client.close();
    await sleep(LEASE_TTL_MS + 500); // longer than the lease: it is renewed meanwhile
    expect(await leaseHolder(player.characterId)).toBe("a");
    expect(await hpInDatabase(player.characterId)).not.toBe(33);

    dbProxy.resume();
    await until(async () => (await leaseHolder(player.characterId)) === null, 20_000);
    expect(await hpInDatabase(player.characterId)).toBe(33);
  });
});

describe("Redis outage", { timeout: 60_000 }, () => {
  it("shorter than the lease: nobody is dropped, leases are renewed afterwards", async () => {
    const player = await login();
    redisProxy.pause();
    await sleep(LEASE_TTL_MS - 1000);
    redisProxy.resume();
    await sleep(LEASE_TTL_MS);
    expect(serverA.lifecycle.get(player.characterId)).toBeDefined();
    expect(await leaseHolder(player.characterId)).toBe("a");
    expect(player.client.packets.some((p) => p.type === "s2c_kicked")).toBe(false);
    player.client.close();
  });
});

describe("Central unreachable", { timeout: 60_000 }, () => {
  it("zone changes are refused right away, the player stays and plays on", async () => {
    const player = await login();
    centralReachableA = false; // heartbeats to the orchestrator fail
    usePortal(player);
    await until(() => player.client.packets.some((p) => p.type === "s2c_chat" && /central services can't be reached/.test(p.text)));
    expect(serverA.lifecycle.get(player.characterId)).toBeDefined();
    expect(player.client.packets.some((p) => p.type === "s2c_reconnect" || p.type === "s2c_kicked")).toBe(false);

    centralReachableA = true;
    usePortal(player);
    const reconnect = await player.client.next("s2c_reconnect", 10_000);
    expect(reconnect.zoneId).toBe("overworld");
    player.client.close();
  });
});
