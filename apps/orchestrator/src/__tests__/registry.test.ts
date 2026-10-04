import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { HeartbeatBody, InstanceReport } from "@mmoexile/contracts";
import { Redis } from "@mmoexile/messaging";
import { DEV_TICKET_PRIVATE_KEY } from "@mmoexile/auth";
import { createLogger } from "@mmoexile/service-kit";
import { Registry } from "../Registry.js";
import { RegistryMirror } from "../RegistryMirror.js";
import { createOrchestrator } from "../app.js";

const identity = (serverId: string) => ({
  serverId,
  url: `ws://${serverId}:7001/ws`,
  internalUrl: `http://${serverId}:9001`,
  region: "local",
  capacity: 100,
});

const heartbeat = (
  serverId: string,
  instances: InstanceReport[] = [],
  extra: Partial<HeartbeatBody> = {},
): HeartbeatBody => ({
  ...identity(serverId),
  state: "ready",
  instances,
  tickP95Ms: 5,
  cpu: 0.1,
  eventLoopUtilization: 0.1,
  ...extra,
});

const nexus = (id: string, players = 0): InstanceReport => ({
  id,
  zoneId: "nexus",
  players,
  state: players > 0 ? "running" : "empty",
});

describe("Registry", () => {
  it("builds the fleet from heartbeats alone (orchestrator restart)", () => {
    const registry = new Registry({ now: () => 0 });
    expect(registry.heartbeat(heartbeat("s1", [nexus("nexus:aaaaaa", 3)]))).toBe("ready");
    registry.heartbeat(heartbeat("s2", [nexus("nexus:bbbbbb")]));

    expect(registry.all().map((s) => s.serverId)).toEqual(["s1", "s2"]);
    expect(registry.serverPlayers(registry.get("s1")!)).toBe(3);
    expect(registry.instances().map((i) => i.id)).toEqual(["nexus:aaaaaa", "nexus:bbbbbb"]);
  });

  it("marks servers dead after three missed heartbeats and forgets them later", () => {
    let clock = 0;
    const registry = new Registry({ now: () => clock, deadAfterMs: 6000, forgetAfterMs: 60_000 });
    registry.heartbeat(heartbeat("s1", [nexus("nexus:aaaaaa", 2)]));
    registry.heartbeat(heartbeat("s2"));

    clock = 4000;
    registry.heartbeat(heartbeat("s2"));
    clock = 6000;
    expect(registry.sweep()).toEqual([]);

    clock = 6001;
    expect(registry.sweep().map((s) => s.serverId)).toEqual(["s1"]);
    expect(registry.get("s1")?.state).toBe("dead");
    expect(registry.get("s1")?.instances.size).toBe(0);
    expect(registry.get("s2")?.state).toBe("ready");

    clock = 70_000;
    registry.sweep();
    expect(registry.get("s1")).toBeUndefined();
  });

  it("revives a dead server that reports again", () => {
    let clock = 0;
    const registry = new Registry({ now: () => clock });
    registry.heartbeat(heartbeat("s1"));
    clock = 10_000;
    registry.sweep();
    expect(registry.get("s1")?.state).toBe("dead");

    registry.heartbeat(heartbeat("s1", [nexus("nexus:cccccc")]));
    expect(registry.get("s1")?.state).toBe("ready");
    expect(registry.get("s1")?.instances.size).toBe(1);
  });

  it("keeps just-created instances that a heartbeat doesn't list yet", () => {
    let clock = 0;
    const registry = new Registry({ now: () => clock, creationGraceMs: 5000 });
    registry.heartbeat(heartbeat("s1"));
    registry.addInstance("s1", { id: "golem_dungeon:111111", zoneId: "golem_dungeon", players: 0, state: "empty" });

    clock = 1000;
    registry.heartbeat(heartbeat("s1"));
    expect(registry.get("s1")?.instances.has("golem_dungeon:111111")).toBe(true);

    clock = 6000;
    registry.heartbeat(heartbeat("s1"));
    expect(registry.get("s1")?.instances.has("golem_dungeon:111111")).toBe(false);
  });

  it("counts reservations until a heartbeat covers them", () => {
    let clock = 0;
    const registry = new Registry({ now: () => clock, reservationTtlMs: 1000 });
    registry.heartbeat(heartbeat("s1", [nexus("nexus:aaaaaa", 1)]));
    const instance = registry.get("s1")!.instances.get("nexus:aaaaaa")!;
    registry.reserve(instance);
    registry.reserve(instance);
    expect(registry.load(instance)).toBe(3);

    // The players arrived; the next heartbeat counts them itself.
    clock = 2000;
    registry.heartbeat(heartbeat("s1", [nexus("nexus:aaaaaa", 3)]));
    expect(registry.load(registry.get("s1")!.instances.get("nexus:aaaaaa")!)).toBe(3);
  });

  it("keeps a requested drain until the server reports draining", () => {
    const registry = new Registry({ now: () => 0 });
    registry.heartbeat(heartbeat("s1"));
    registry.drain("s1");
    expect(registry.heartbeat(heartbeat("s1"))).toBe("draining");
    expect(registry.heartbeat(heartbeat("s1", [], { state: "stopped" }))).toBe("stopped");
  });
});

describe("Orchestrator restart", () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(process.env.TEST_REDIS_URL!);
  });
  afterAll(async () => {
    await redis.quit();
  });

  it("waits for the first heartbeats instead of answering 'fleet full'", async () => {
    const orchestrator = createOrchestrator({
      config: { HEARTBEAT_INTERVAL_MS: 200, TICKET_PRIVATE_KEY: DEV_TICKET_PRIVATE_KEY },
      logger: createLogger("test", "silent"),
      redis,
    });
    const pending = orchestrator.app.inject({
      method: "POST",
      url: "/allocate",
      payload: { zoneId: "nexus", characterId: "c", accountId: "a", region: "local" },
    });
    await new Promise((r) => setTimeout(r, 100));
    orchestrator.registry.heartbeat({
      ...heartbeat("warm-s1", [nexus("nexus:eeeeee")]),
    });
    const response = await pending;
    expect(response.statusCode).toBe(200);
    expect(response.json().instanceId).toBe("nexus:eeeeee");
    await orchestrator.stop();
  });
});

describe("Registry mirror", () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(process.env.TEST_REDIS_URL!);
  });
  afterAll(async () => {
    await redis.quit();
  });

  it("restores the fleet after a restart, before the first heartbeat", async () => {
    const logger = createLogger("test", "silent");
    const config = { HEARTBEAT_INTERVAL_MS: 2000, TICKET_PRIVATE_KEY: DEV_TICKET_PRIVATE_KEY };
    const first = createOrchestrator({ config, logger, redis });
    first.registry.heartbeat(heartbeat("mirror-s1", [nexus("nexus:dddddd", 4)]));
    await new RegistryMirror(redis).save(first.registry.view(first.registry.get("mirror-s1")!));
    await first.stop();

    const second = createOrchestrator({ config, logger, redis });
    await second.start();
    const restored = second.registry.get("mirror-s1");
    expect(restored?.state).toBe("ready");
    expect(second.registry.serverPlayers(restored!)).toBe(4);

    const response = await second.app.inject({ method: "GET", url: "/servers" });
    expect(response.json().servers.map((s: { serverId: string }) => s.serverId)).toContain("mirror-s1");
    await second.stop();
  });
});
