import WebSocket from "ws";
import { prisma } from "@mmoexile/db";
import { Redis, RedisBroker } from "@mmoexile/messaging";
import { createLogger } from "@mmoexile/service-kit";
import { redisKeys } from "@mmoexile/contracts";
import { DEV_TICKET_PRIVATE_KEY } from "@mmoexile/auth";
import {
  createOrchestrator,
  type Orchestrator,
} from "@mmoexile/orchestrator";
import { buildApp as buildAccountApi, readConfig as readAccountConfig } from "@mmoexile/account-api";
import {
  createInstanceServer,
  InMemoryPartyDirectory,
  readConfig,
  type InstanceServer,
} from "@mmoexile/instance-server";
import {
  deserializePacket,
  serializePacket,
  PROTOCOL_VERSION,
  type ClientPacket,
  type ServerPacket,
} from "@mmoexile/protocol";

/**
 * A whole realm in one process: an orchestrator plus N instance servers,
 * talking over real HTTP, WebSockets, Postgres and Redis. Social is replaced
 * by an in-memory party directory.
 */
export interface Realm {
  orchestrator: Orchestrator;
  orchestratorUrl: string;
  /** account-api base URL (login, characters, /play). */
  accountApiUrl: string;
  servers: Map<string, InstanceServer>;
  redis: Redis;
  heartbeatMs: number;
  /** Starts one more instance server. */
  addServer(serverId: string, env?: Record<string, string>): Promise<InstanceServer>;
  /** Replaces the orchestrator with a fresh process on the same port. */
  restartOrchestrator(options?: { keepMirror?: boolean }): Promise<void>;
  stop(): Promise<void>;
}

export interface RealmOptions {
  servers?: string[];
  heartbeatMs?: number;
  /** Extra instance-server environment. */
  env?: Record<string, string>;
}

const logLevel = (process.env.REALM_LOG_LEVEL ?? "silent") as "silent";

export async function startRealm(options: RealmOptions = {}): Promise<Realm> {
  const heartbeatMs = options.heartbeatMs ?? 200;
  const redisUrl = process.env.TEST_REDIS_URL!;
  const connections: { quit(): Promise<unknown> }[] = [];
  const redis = new Redis(redisUrl);
  const sharedBroker = new RedisBroker({ redis: new Redis(redisUrl) });
  const parties = new InMemoryPartyDirectory(sharedBroker);

  // Each realm gets a clean fleet mirror.
  const stale = await redis.keys(redisKeys.fleetServerPattern);
  if (stale.length > 0) await redis.del(...stale);

  const newOrchestrator = () =>
    createOrchestrator({
      config: { HEARTBEAT_INTERVAL_MS: heartbeatMs, TICKET_PRIVATE_KEY: DEV_TICKET_PRIVATE_KEY },
      logger: createLogger("orchestrator", logLevel),
      redis,
    });

  let orchestrator = newOrchestrator();
  await orchestrator.start();
  await orchestrator.app.listen({ port: 0, host: "127.0.0.1" });
  const orchestratorPort = (orchestrator.app.server.address() as { port: number }).port;
  const orchestratorUrl = `http://127.0.0.1:${orchestratorPort}`;

  const accountApi = buildAccountApi({
    config: readAccountConfig({ ORCHESTRATOR_URL: orchestratorUrl }),
    logger: createLogger("account-api", logLevel),
    db: prisma,
  });
  await accountApi.listen({ port: 0, host: "127.0.0.1" });
  const accountApiUrl = `http://127.0.0.1:${(accountApi.server.address() as { port: number }).port}`;

  const servers = new Map<string, InstanceServer>();

  const addServer = async (serverId: string, env: Record<string, string> = {}) => {
    const config = readConfig({
      SERVER_ID: serverId,
      REDIS_URL: redisUrl,
      INTERNAL_PORT: "0",
      ORCHESTRATOR_URL: orchestratorUrl,
      HEARTBEAT_INTERVAL_MS: String(heartbeatMs),
      ...options.env,
      ...env,
    });
    const serverRedis = new Redis(redisUrl);
    const broker = new RedisBroker({ redis: serverRedis });
    connections.push({ quit: () => broker.close() }, serverRedis);
    // Like main.ts: a drain request drains, then stops the server.
    const server: InstanceServer = await createInstanceServer({
      config,
      logger: createLogger(`instance-server-${serverId}`, logLevel),
      db: prisma,
      redis: serverRedis,
      broker,
      parties,
      onDrainRequested: () => {
        if (!server.draining) void server.drain().then(() => server.stop());
      },
    });
    await server.listen(0);
    servers.set(serverId, server);
    return server;
  };

  for (const serverId of options.servers ?? ["s1", "s2", "s3"]) {
    await addServer(serverId);
  }

  return {
    get orchestrator() {
      return orchestrator;
    },
    orchestratorUrl,
    accountApiUrl,
    servers,
    redis,
    heartbeatMs,
    addServer,
    async restartOrchestrator({ keepMirror = true } = {}) {
      await orchestrator.stop();
      if (!keepMirror) {
        const keys = await redis.keys(redisKeys.fleetServerPattern);
        if (keys.length > 0) await redis.del(...keys);
      }
      orchestrator = newOrchestrator();
      await orchestrator.start();
      await orchestrator.app.listen({ port: orchestratorPort, host: "127.0.0.1" });
    },
    async stop() {
      for (const server of servers.values()) await server.stop().catch(() => {});
      await accountApi.close();
      await orchestrator.stop();
      await sharedBroker.close();
      for (const c of connections.reverse()) await c.quit().catch(() => {});
      await redis.quit();
    },
  };
}

// --- Players ---

/** A raw protocol client that follows reconnects like the real client. */
export class TestClient {
  readonly packets: ServerPacket[] = [];
  url = "";
  private ws!: WebSocket;
  private welcomes = 0;

  constructor(url: string, ticket: string) {
    this.connect(url, ticket);
  }

  private connect(url: string, ticket: string) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("message", (data: ArrayBuffer) => {
      const packet = deserializePacket<ServerPacket>(data);
      this.packets.push(packet);
      if (packet.type === "s2c_welcome") this.welcomes++;
      if (packet.type === "s2c_reconnect") {
        this.ws.removeAllListeners();
        this.ws.close();
        this.connect(packet.url, packet.ticket);
      }
    });
    this.ws.on("open", () =>
      this.send({ type: "c2s_hello", ticket, protocolVersion: PROTOCOL_VERSION }),
    );
  }

  /** The most recent welcome, once there are at least `count` of them. */
  async welcome(count = 1, timeoutMs = 10_000) {
    await until(() => this.welcomes >= count, timeoutMs);
    return this.packets.filter((p) => p.type === "s2c_welcome").at(-1) as Extract<
      ServerPacket,
      { type: "s2c_welcome" }
    >;
  }

  async next<T extends ServerPacket["type"]>(type: T, timeoutMs = 10_000) {
    await until(() => this.packets.some((p) => p.type === type), timeoutMs);
    return this.packets.find((p) => p.type === type) as Extract<ServerPacket, { type: T }>;
  }

  send(packet: ClientPacket) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(serializePacket(packet));
  }

  close() {
    this.ws.removeAllListeners();
    this.ws.close();
  }
}

export async function newCharacter(hp = 100): Promise<{ characterId: string; accountId: string }> {
  const account = await prisma.account.create({
    data: {
      nickname: `Hero${Math.floor(Math.random() * 1e6)}`,
      refreshSecretHash: `h-${Math.random()}`,
    },
  });
  const character = await prisma.character.create({ data: { accountId: account.id, hp } });
  return { characterId: character.id, accountId: account.id };
}

export async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  message = "condition",
): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
