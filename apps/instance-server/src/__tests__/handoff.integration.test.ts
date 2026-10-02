import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "net";
import WebSocket from "ws";
import { prisma } from "@mmoexile/db";
import { Redis, RedisBroker } from "@mmoexile/messaging";
import { randomUUID } from "node:crypto";
import { DEV_TICKET_PRIVATE_KEY, signTicket, ticketSigningKey } from "@mmoexile/auth";
import { redisKeys, type AllocateRequest } from "@mmoexile/contracts";
import { Health, Position } from "@mmoexile/game-core";
import {
  deserializePacket,
  serializePacket,
  PROTOCOL_VERSION,
  type ServerPacket,
} from "@mmoexile/protocol";
import { createLogger } from "@mmoexile/service-kit";
import { readConfig } from "../config.js";
import { createInstanceServer, type InstanceServer } from "../server.js";
import { CharacterOwnership } from "../ownership/CharacterOwnership.js";
import { InMemoryPartyDirectory } from "../party/PartyDirectory.js";
import type { ZoneAllocator } from "../fleet/ZoneAllocator.js";

// --- Harness: two instance servers (a: nexus, b: overworld + dungeon) ---

const ticketKey = await ticketSigningKey(DEV_TICKET_PRIVATE_KEY);

/** Stand-in for the orchestrator: nexus on a, everything else on b. */
const allocator: ZoneAllocator = {
  async allocate(request: AllocateRequest) {
    const serverId = request.zoneId === "nexus" ? "a" : "b";
    const ticketId = randomUUID();
    const ticket = await signTicket(
      { ...request, ticketId, targetServerId: serverId },
      ticketKey,
    );
    return { serverId, instanceId: "", url: urls[serverId], ticket, ticketId };
  },
};
const connections: { redis: Redis; broker: RedisBroker }[] = [];
let serverA: InstanceServer;
let serverB: InstanceServer;
let urls: Record<"a" | "b", string>;
let redis: Redis;
let sharedBroker: RedisBroker;
let parties: InMemoryPartyDirectory;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(serverId: "a" | "b", port: number, servers: string) {
  const config = readConfig({
    SERVER_ID: serverId,
    SERVERS: servers,
    ZONE_PLACEMENT: "nexus:a,overworld:b,golem_dungeon:b",
    REDIS_URL: process.env.TEST_REDIS_URL,
    INTERNAL_PORT: "0",
    ORCHESTRATOR_URL: "",
  });
  const redis = new Redis(process.env.TEST_REDIS_URL!);
  const broker = new RedisBroker({ redis });
  connections.push({ redis, broker });
  const server = await createInstanceServer({
    config,
    logger: createLogger(`test-${serverId}`, "silent"),
    db: prisma,
    redis,
    broker,
    // Stand-in for the social service, shared by both servers
    parties,
    allocator,
  });
  await server.listen(port);
  return server;
}

beforeAll(async () => {
  redis = new Redis(process.env.TEST_REDIS_URL!);
  sharedBroker = new RedisBroker({ redis: new Redis(process.env.TEST_REDIS_URL!) });
  parties = new InMemoryPartyDirectory(sharedBroker);
  const [pa, pb] = [await freePort(), await freePort()];
  urls = { a: `ws://127.0.0.1:${pa}/ws`, b: `ws://127.0.0.1:${pb}/ws` };
  const servers = `a=${urls.a},b=${urls.b}`;
  serverA = await startServer("a", pa, servers);
  serverB = await startServer("b", pb, servers);
});

afterAll(async () => {
  await serverA.stop();
  await serverB.stop();
  for (const c of connections) {
    await c.broker.close();
    await c.redis.quit();
  }
  await sharedBroker.close();
  await redis.quit();
});

// --- Test client ---

class TestClient {
  readonly packets: ServerPacket[] = [];
  private ws: WebSocket;
  readonly closed: Promise<void>;

  constructor(url: string, ticket: string, protocolVersion = PROTOCOL_VERSION) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("message", (data: ArrayBuffer) =>
      this.packets.push(deserializePacket<ServerPacket>(data)),
    );
    this.ws.on("open", () =>
      this.ws.send(serializePacket({ type: "c2s_hello", ticket, protocolVersion })),
    );
    this.closed = new Promise((resolve) => this.ws.on("close", () => resolve()));
  }

  async next<T extends ServerPacket["type"]>(type: T, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.packets.find((p) => p.type === type);
      if (found) return found as Extract<ServerPacket, { type: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`No ${type} within ${timeoutMs} ms; got ${this.packets.map((p) => p.type)}`);
  }

  send(packet: Parameters<typeof serializePacket>[0]) {
    this.ws.send(serializePacket(packet));
  }

  close() {
    this.ws.close();
  }
}

async function newCharacter(): Promise<{ characterId: string; accountId: string }> {
  const account = await prisma.account.create({
    data: { nickname: `Hero${Math.floor(Math.random() * 1e6)}`, refreshSecretHash: `h-${Math.random()}` },
  });
  const character = await prisma.character.create({ data: { accountId: account.id, hp: 100 } });
  return { characterId: character.id, accountId: account.id };
}

const loginTicket = (c: { characterId: string; accountId: string }, server = "a") =>
  signTicket({ ...c, zoneId: "nexus", targetServerId: server }, ticketKey);

const until = async (check: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const leaseHolder = async (characterId: string) => {
  const raw = await redis.get(redisKeys.lease(characterId));
  return raw ? JSON.parse(raw).serverId : null;
};

// --- Tests ---

describe("Ticket admission", () => {
  it("admits a character with a valid ticket and takes its lease", async () => {
    const c = await newCharacter();
    const client = new TestClient(urls.a, await loginTicket(c));

    const welcome = await client.next("s2c_welcome");
    expect(welcome.zoneId).toBe("nexus");
    expect(welcome.instanceId).toMatch(/^nexus:/);
    expect(await leaseHolder(c.characterId)).toBe("a");

    client.close();
    await until(async () => (await leaseHolder(c.characterId)) === null);
  });

  it("rejects replayed tickets, tickets for other servers, and old clients", async () => {
    const c = await newCharacter();
    const ticket = await loginTicket(c);
    const first = new TestClient(urls.a, ticket);
    await first.next("s2c_welcome");
    first.close();
    await until(async () => (await leaseHolder(c.characterId)) === null);

    const replay = new TestClient(urls.a, ticket);
    expect((await replay.next("s2c_kicked")).reason).toBe("invalid_ticket");

    const wrongServer = new TestClient(urls.b, await loginTicket(c, "a"));
    expect((await wrongServer.next("s2c_kicked")).reason).toBe("invalid_ticket");

    const oldClient = new TestClient(urls.a, await loginTicket(c), 1);
    expect((await oldClient.next("s2c_kicked")).reason).toBe("version_mismatch");
  });
});

describe("Portal handoff between servers", () => {
  it("saves on A, releases, and continues on B with the same state", async () => {
    const c = await newCharacter();
    const client = new TestClient(urls.a, await loginTicket(c));
    await client.next("s2c_welcome");

    // Change state on A, then stand at the nexus portal (20, 9) and use it
    const instance = serverA.host.getInstanceForPlayer(c.characterId)!;
    const eid = instance.world.uuidToEid.get(c.characterId)!;
    Health.current[eid] = 42;
    Position.x[eid] = 20;
    Position.y[eid] = 9.5;
    client.send({ type: "c2s_interact" });

    const reconnect = await client.next("s2c_reconnect");
    expect(reconnect.url).toBe(urls.b);
    expect(reconnect.zoneId).toBe("overworld");
    expect(serverA.host.getInstanceForPlayer(c.characterId)).toBeUndefined();
    expect(await leaseHolder(c.characterId)).toBeNull();
    client.close();

    const onB = new TestClient(reconnect.url, reconnect.ticket);
    const welcome = await onB.next("s2c_welcome");
    expect(welcome.zoneId).toBe("overworld");
    expect(welcome.playerState.hp).toBe(42); // saved by A before releasing
    expect(await leaseHolder(c.characterId)).toBe("b");
    onB.close();
    await until(async () => (await leaseHolder(c.characterId)) === null);
  });
});

describe("Duplicate login", () => {
  it("newest login wins: the old session is saved and kicked", async () => {
    const c = await newCharacter();
    const old = new TestClient(urls.a, await loginTicket(c));
    await old.next("s2c_welcome");

    const fresh = new TestClient(urls.a, await loginTicket(c));
    expect((await old.next("s2c_kicked")).reason).toBe("logged_in_elsewhere");
    await fresh.next("s2c_welcome");
    expect(await leaseHolder(c.characterId)).toBe("a");
    fresh.close();
  });

  it("kicks a session on another server through the broker", async () => {
    const c = await newCharacter();
    const first = new TestClient(urls.a, await loginTicket(c));
    await first.next("s2c_welcome");
    const instance = serverA.host.getInstanceForPlayer(c.characterId)!;
    const eid = instance.world.uuidToEid.get(c.characterId)!;
    Position.x[eid] = 20;
    Position.y[eid] = 9.5;
    first.send({ type: "c2s_interact" });
    const reconnect = await first.next("s2c_reconnect");
    first.close();
    const onB = new TestClient(reconnect.url, reconnect.ticket);
    await onB.next("s2c_welcome");

    // Log in again from scratch on A while the character is on B
    const again = new TestClient(urls.a, await loginTicket(c));
    expect((await onB.next("s2c_kicked")).reason).toBe("logged_in_elsewhere");
    await again.next("s2c_welcome");
    expect(await leaseHolder(c.characterId)).toBe("a");
    again.close();
  });
});

describe("Fencing", () => {
  it("a server that lost ownership cannot overwrite newer data", async () => {
    const c = await newCharacter();
    const client = new TestClient(urls.a, await loginTicket(c));
    await client.next("s2c_welcome");
    const instance = serverA.host.getInstanceForPlayer(c.characterId)!;
    Health.current[instance.world.uuidToEid.get(c.characterId)!] = 5;

    // Another server takes over behind A's back and writes newer data
    const other = new CharacterOwnership({ redis, db: prisma });
    const taken = await other.forceAcquire(c.characterId, { serverId: "elsewhere" });
    await other.writeFenced(taken, { hp: 99 });

    client.close();
    await until(() => serverA.lifecycle.get(c.characterId) === undefined);
    await new Promise((r) => setTimeout(r, 100));

    const row = await prisma.character.findUnique({ where: { id: c.characterId } });
    expect(row?.hp).toBe(99);
    await other.release(taken);
  });
});

describe("Shutdown", () => {
  it("saves, releases and kicks every character", async () => {
    const [pa, pb] = [await freePort(), await freePort()];
    const servers = `a=ws://127.0.0.1:${pa}/ws,b=ws://127.0.0.1:${pb}/ws`;
    const temp = await startServer("a", pa, servers);
    const c = await newCharacter();
    const client = new TestClient(`ws://127.0.0.1:${pa}/ws`, await loginTicket(c));
    await client.next("s2c_welcome");
    const instance = temp.host.getInstanceForPlayer(c.characterId)!;
    Health.current[instance.world.uuidToEid.get(c.characterId)!] = 61;

    await temp.stop();

    expect((await client.next("s2c_kicked")).reason).toBe("server_shutdown");
    expect(await leaseHolder(c.characterId)).toBeNull();
    const row = await prisma.character.findUnique({ where: { id: c.characterId } });
    expect(row?.hp).toBe(61);
  });
});
