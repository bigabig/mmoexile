import { describe, it, expect } from "vitest";
import { ZONES } from "@mmoexile/game-core";
import type { HeartbeatBody } from "@mmoexile/contracts";
import { createLogger } from "@mmoexile/service-kit";
import { Registry } from "../Registry.js";
import { Allocator } from "../Allocator.js";
import {
  chooseServer,
  findInstance,
  serverScore,
  targetRegion,
  type InstanceCandidate,
  type ServerCandidate,
} from "../placement.js";

const server = (serverId: string, extra: Partial<ServerCandidate> = {}): ServerCandidate => ({
  serverId,
  state: "ready",
  capacity: 100,
  players: 0,
  instances: 0,
  tickP95Ms: 5,
  ...extra,
});

describe("placement scoring", () => {
  it("prefers fewer players and instances, and penalizes slow ticks", () => {
    expect(serverScore({ players: 10, instances: 2, tickP95Ms: 5 })).toBe(20);
    expect(serverScore({ players: 10, instances: 2, tickP95Ms: 25 })).toBe(70);

    const best = chooseServer([
      server("busy", { players: 30 }),
      server("idle-but-slow", { tickP95Ms: 30 }),
      server("idle"),
    ]);
    expect(best?.serverId).toBe("idle");
  });

  it("avoids servers whose event loop is saturated, even with fast ticks", () => {
    expect(serverScore({ players: 0, instances: 0, tickP95Ms: 1, eventLoopUtilization: 0.9 })).toBeCloseTo(150);
    const best = chooseServer([
      server("saturated", { eventLoopUtilization: 0.95 }),
      server("busy-but-fine", { players: 40, instances: 10, eventLoopUtilization: 0.5 }),
    ]);
    expect(best?.serverId).toBe("busy-but-fine");
  });

  it("never places on draining, dead, full or excluded servers", () => {
    const servers = [
      server("draining", { state: "draining" }),
      server("dead", { state: "dead" }),
      server("full", { players: 100 }),
      server("excluded"),
    ];
    expect(chooseServer(servers, { excludeServerId: "excluded" })).toBeUndefined();
    expect(chooseServer(servers)?.serverId).toBe("excluded");
  });
});

describe("instance selection across the fleet", () => {
  const instance = (id: string, extra: Partial<InstanceCandidate> = {}): InstanceCandidate => ({
    id,
    serverId: "s1",
    zoneId: "nexus",
    players: 0,
    ...extra,
  });

  it("public zones fill the fullest shard below the soft cap, or honor a preference", () => {
    const { softCap } = ZONES.nexus.access as { softCap: number };
    const shards = [
      instance("nexus:a", { players: 3 }),
      instance("nexus:b", { players: 12, serverId: "s2" }),
      instance("nexus:c", { players: softCap }),
    ];
    expect(findInstance(ZONES.nexus, { characterId: "c" }, shards)?.id).toBe("nexus:b");
    expect(
      findInstance(ZONES.nexus, { characterId: "c", preferInstanceId: "nexus:c" }, shards)?.id,
    ).toBe("nexus:c");
    expect(findInstance(ZONES.nexus, { characterId: "c" }, [shards[2]])).toBeUndefined();
  });

  it("party_private zones are found by party, solo players by character", () => {
    const dungeons = [
      instance("golem_dungeon:1", { zoneId: "golem_dungeon", ownerPartyId: "party_x" }),
      instance("golem_dungeon:2", { zoneId: "golem_dungeon", ownerPartyId: "solo:c9" }),
    ];
    const zone = ZONES.golem_dungeon;
    expect(findInstance(zone, { characterId: "c1", partyId: "party_x" }, dungeons)?.id).toBe("golem_dungeon:1");
    expect(findInstance(zone, { characterId: "c9" }, dungeons)?.id).toBe("golem_dungeon:2");
    expect(findInstance(zone, { characterId: "c2" }, dungeons)).toBeUndefined();
  });
});

describe("Allocator", () => {
  const heartbeat = (serverId: string, region = "local"): HeartbeatBody => ({
    serverId,
    url: `ws://${serverId}/ws`,
    internalUrl: `http://${serverId}`,
    region,
    capacity: 100,
    state: "ready",
    instances: [],
    tickP95Ms: 1,
    cpu: 0,
    eventLoopUtilization: 0.1,
  });

  /**
   * Instance servers that accept creation requests, except `failing`.
   * A server ID like "eu1@eu" puts the server into region "eu".
   */
  function setup(serverIds: string[], failing: string[] = []) {
    const registry = new Registry();
    for (const spec of serverIds) {
      const [id, region] = spec.split("@");
      registry.heartbeat(heartbeat(id, region));
    }
    const created: string[] = [];
    const fetch = (async (url: string) => {
      const serverId = new URL(url).hostname;
      await new Promise((r) => setTimeout(r, 10));
      if (failing.includes(serverId)) throw new Error("ECONNREFUSED");
      created.push(serverId);
      return new Response(JSON.stringify({ instanceId: "ignored" }), { status: 200 });
    }) as typeof globalThis.fetch;
    const allocator = new Allocator({
      registry,
      logger: createLogger("test", "silent"),
      fetch,
      signTicket: async (claims) => JSON.stringify(claims),
    });
    return { registry, allocator, created };
  }

  const request = (characterId: string, extra = {}) => ({
    zoneId: "golem_dungeon",
    characterId,
    accountId: "acc",
    region: "local",
    ...extra,
  });

  it("creates one instance for a party even when members arrive at once", async () => {
    const { allocator, created } = setup(["s1", "s2"]);
    const results = await Promise.all(
      ["a", "b", "c"].map((id) => allocator.allocate(request(id, { partyId: "party_1" }))),
    );
    expect(new Set(results.map((r) => r.instanceId)).size).toBe(1);
    expect(created).toHaveLength(1);
    expect(JSON.parse(results[0].ticket)).toMatchObject({
      instanceId: results[0].instanceId,
      targetServerId: results[0].serverId,
      partyId: "party_1",
      region: "local",
    });
  });

  it("spreads new instances across servers", async () => {
    const { allocator } = setup(["s1", "s2", "s3"]);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const { serverId } = await allocator.allocate(request(`solo${i}`));
      counts[serverId] = (counts[serverId] ?? 0) + 1;
    }
    expect(counts).toEqual({ s1: 10, s2: 10, s3: 10 });
  });

  it("skips a server that cannot create instances", async () => {
    const { allocator } = setup(["s1", "s2"], ["s1"]);
    expect((await allocator.allocate(request("x"))).serverId).toBe("s2");
  });

  it("stops sending players to a server that went quiet, before it is declared dead", async () => {
    let clock = 0;
    const registry = new Registry({ now: () => clock, deadAfterMs: 6000 });
    for (const id of ["s1", "s2"]) {
      registry.heartbeat({ ...heartbeat(id), instances: [{ id: `overworld:${id}`, zoneId: "overworld", players: id === "s1" ? 30 : 5, state: "running" }] });
    }
    const allocator = new Allocator({
      registry,
      logger: createLogger("test", "silent"),
      signTicket: async () => "t",
    });
    // Fill first: the fuller shard on s1
    expect((await allocator.allocate({ ...request("a"), zoneId: "overworld" })).instanceId).toBe("overworld:s1");

    // s1 crashed 3.5 s ago: still "ready" in the registry, but silent
    clock = 3500;
    registry.heartbeat({ ...heartbeat("s2"), instances: [{ id: "overworld:s2", zoneId: "overworld", players: 5, state: "running" }] });
    expect(registry.get("s1")?.state).toBe("ready");
    expect((await allocator.allocate({ ...request("b"), zoneId: "overworld" })).instanceId).toBe("overworld:s2");
  });

  it("fails with 503 when no server can take players", async () => {
    const { allocator, registry } = setup(["s1"]);
    registry.drain("s1");
    await expect(allocator.allocate(request("x"))).rejects.toMatchObject({ statusCode: 503 });
    await expect(allocator.allocate({ ...request("x"), zoneId: "moon" })).rejects.toMatchObject({ statusCode: 400 });
  });

  describe("regions", () => {
    const fleet = () => setup(["eu1@eu", "eu2@eu", "us1@us"]);
    const regionOf = (registry: Registry, serverId: string) => registry.get(serverId)?.region;

    it("places public zones only in the player's home region, one shard set per region", async () => {
      const { allocator, registry } = fleet();
      const eu = await allocator.allocate(request("anna", { zoneId: "nexus", region: "eu" }));
      const us = await allocator.allocate(request("ben", { zoneId: "nexus", region: "us" }));
      expect(regionOf(registry, eu.serverId)).toBe("eu");
      expect(us.serverId).toBe("us1");
      // Ben does not join Anna's emptier EU hub, nor the other way round
      expect(us.instanceId).not.toBe(eu.instanceId);
      const eu2 = await allocator.allocate(request("carl", { zoneId: "nexus", region: "eu" }));
      expect(eu2.instanceId).toBe(eu.instanceId);
    });

    it("creates a party's dungeon in the leader's region and lets members join it from anywhere", async () => {
      const { allocator } = fleet();
      // Ben (US) is in Anna's party; Anna (EU) leads
      const ben = await allocator.allocate(
        request("ben", { region: "us", leaderRegion: "eu", partyId: "party_ab" }),
      );
      expect(ben.serverId).toMatch(/^eu/);
      // Anna arrives later and joins the same instance
      const anna = await allocator.allocate(request("anna", { region: "eu", leaderRegion: "eu", partyId: "party_ab" }));
      expect(anna.instanceId).toBe(ben.instanceId);
      // The ticket keeps Ben's home region, so he returns to US hubs afterwards
      expect(JSON.parse(ben.ticket)).toMatchObject({ region: "us" });
      // An existing party instance is joined across regions, whatever the leader's region says now
      const late = await allocator.allocate(request("cleo", { region: "us", leaderRegion: "us", partyId: "party_ab" }));
      expect(late.instanceId).toBe(ben.instanceId);
    });

    it("solo players get private instances in their own region", async () => {
      const { allocator } = fleet();
      expect((await allocator.allocate(request("ben", { region: "us" }))).serverId).toBe("us1");
    });

    it("refuses with region_unavailable instead of spilling into another region", async () => {
      const { allocator, registry } = fleet();
      registry.drain("us1");
      await expect(allocator.allocate(request("ben", { zoneId: "nexus", region: "us" }))).rejects.toMatchObject({
        statusCode: 503,
        reason: "region_unavailable",
      });
      await expect(allocator.allocate(request("ben", { zoneId: "nexus", region: "ap" }))).rejects.toMatchObject({
        reason: "region_unavailable",
      });
      expect(regionOf(registry, (await allocator.allocate(request("anna", { zoneId: "nexus", region: "eu" }))).serverId)).toBe("eu");
    });
  });

  it("puts portal_bound instances into the region of the portal's instance", () => {
    const zone = { ...ZONES.golem_dungeon, access: { kind: "portal_bound" as const } };
    const regions: Record<string, string> = { "overworld:us": "us" };
    const via = { sourceInstanceId: "overworld:us", portalId: "p1" };
    expect(targetRegion(zone, { characterId: "c", region: "eu", via }, (id) => regions[id])).toBe("us");
    // Unknown source instance (its server is gone): fall back to the home region
    expect(
      targetRegion(zone, { characterId: "c", region: "eu", via: { ...via, sourceInstanceId: "x" } }, (id) => regions[id]),
    ).toBe("eu");
  });
});
