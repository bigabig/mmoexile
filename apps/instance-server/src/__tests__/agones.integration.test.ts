import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { prisma } from "@mmoexile/db";
import { RedisBroker, Redis } from "@mmoexile/messaging";
import { createLogger } from "@mmoexile/service-kit";
import { instanceServerApi, type HeartbeatBody } from "@mmoexile/contracts";
import { readConfig } from "../config.js";
import { createInstanceServer, type InstanceServer } from "../server.js";
import { AgonesSdk } from "../fleet/AgonesSdk.js";

/**
 * LIFECYCLE=agones against Agones' real SDK server in local mode (the same
 * image Agones runs as the sidecar of every GameServer pod), no cluster.
 */

const GAME_SERVER = `
apiVersion: agones.dev/v1
kind: GameServer
metadata: { name: instance-server-eu-test }
status:
  state: Scheduled
  address: 172.22.0.2
  ports: [{ name: game, port: 7302 }]
  counters:
    players: { count: 0, capacity: 0 }
`;

/** Stand-in for the orchestrator: records heartbeats, answers with `hold`. */
let hold = false;
const heartbeats: HeartbeatBody[] = [];
const orchestrator = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/register")) return res.end(JSON.stringify({ heartbeatIntervalMs: 100 }));
    heartbeats.push(JSON.parse(body));
    res.end(JSON.stringify({ desiredState: "ready", hold }));
  });
});

let sidecar: StartedTestContainer;
let sdk: AgonesSdk;
let server: InstanceServer;
let redis: Redis;
let broker: RedisBroker;

beforeAll(async () => {
  sidecar = await new GenericContainer("us-docker.pkg.dev/agones-images/release/agones-sdk:1.61.0")
    .withCopyContentToContainer([{ content: GAME_SERVER, target: "/gameserver.yaml" }])
    .withCommand(["--local", "-f", "/gameserver.yaml", "--address", "0.0.0.0"])
    .withExposedPorts(9358)
    .withWaitStrategy(Wait.forHttp("/gameserver", 9358))
    .start();
  const sdkUrl = `http://${sidecar.getHost()}:${sidecar.getMappedPort(9358)}`;
  sdk = new AgonesSdk({ baseUrl: sdkUrl });

  await new Promise<void>((resolve) => orchestrator.listen(0, resolve));
  const orchestratorPort = (orchestrator.address() as AddressInfo).port;

  const config = readConfig({
    SERVER_ID: "instance-server-eu-test",
    REDIS_URL: process.env.TEST_REDIS_URL,
    INTERNAL_PORT: "0",
    ORCHESTRATOR_URL: `http://localhost:${orchestratorPort}`,
    HEARTBEAT_INTERVAL_MS: "100",
    REGION: "eu",
    CAPACITY: "60",
    LIFECYCLE: "agones",
    PUBLIC_HOST: "localhost",
  });
  redis = new Redis(process.env.TEST_REDIS_URL!);
  broker = new RedisBroker({ redis });
  server = await createInstanceServer({
    config,
    logger: createLogger("test-agones", "silent"),
    db: prisma,
    redis,
    broker,
    agonesSdk: sdk,
  });
  await server.listen(0);
}, 120_000);

afterAll(async () => {
  await broker?.close();
  await redis?.quit();
  orchestrator.close();
  await sidecar?.stop();
});

const state = async () => (await sdk.gameServer()).state;
const until = async (check: () => Promise<boolean>, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("instance server with LIFECYCLE=agones", () => {
  it("registers with the host port Agones assigned and becomes Ready", async () => {
    expect(heartbeats[0]).toMatchObject({ serverId: "instance-server-eu-test", url: "ws://localhost:7302/ws", region: "eu" });
    expect(await state()).toBe("Ready");
    const counter = await fetch(new URL("/v1beta1/counters/players", sidecarUrl())).then((r) => r.json());
    expect(counter).toMatchObject({ count: "0", capacity: "60" });
  });

  it("is Allocated while the orchestrator says players are on their way", async () => {
    hold = true;
    await until(async () => (await state()) === "Allocated");
    hold = false;
    await until(async () => (await state()) === "Ready");
  });

  it("is Allocated before it answers the orchestrator's create-instance call", async () => {
    const response = await fetch(`http://localhost:${server.internalPort}${instanceServerApi.createInstance.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId: "golem_dungeon:abc123", zoneId: "golem_dungeon" }),
    });
    expect(response.status).toBe(200);
    expect(await state()).toBe("Allocated");
  });

  it("shuts the GameServer down after stopping", async () => {
    await server.stop();
    expect(await state()).toBe("Shutdown");
  });
});

function sidecarUrl(): string {
  return `http://${sidecar.getHost()}:${sidecar.getMappedPort(9358)}`;
}
