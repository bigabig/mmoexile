import { describe, it, expect } from "vitest";
import type { HeartbeatBody } from "@mmoexile/contracts";
import { InstanceHost } from "../cluster/index.js";
import { FleetAgent } from "../fleet/FleetAgent.js";

/** A fake orchestrator: records requests, answers with `desiredState`. */
function fakeOrchestrator(answer: { desiredState: string; down?: boolean }) {
  const requests: { url: string; body: HeartbeatBody }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (answer.down) throw new Error("ECONNREFUSED");
    requests.push({ url, body: JSON.parse(init.body as string) });
    const body = url.endsWith("/register")
      ? { heartbeatIntervalMs: 2000 }
      : { desiredState: answer.desiredState };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

const identity = {
  serverId: "s1",
  url: "ws://localhost:7001/ws",
  internalUrl: "http://localhost:9001",
  region: "local",
  capacity: 100,
};

describe("FleetAgent", () => {
  it("registers, then reports state and instances", async () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    host.registerPlayer({ playerId: "p1", name: "P1" });
    const orchestrator = fakeOrchestrator({ desiredState: "ready" });
    const agent = new FleetAgent({ identity, orchestratorUrl: "http://o", host, fetch: orchestrator.fetch });

    await agent.start();
    const [register, heartbeat] = orchestrator.requests;
    expect(register.url).toBe("http://o/servers/register");
    expect(heartbeat.url).toBe("http://o/servers/s1/heartbeat");
    expect(heartbeat.body).toMatchObject({ serverId: "s1", state: "ready" });
    expect(heartbeat.body.instances).toEqual([
      expect.objectContaining({ zoneId: "nexus", players: 1, state: "running" }),
    ]);

    await agent.stop();
    expect(orchestrator.requests.at(-1)?.body.state).toBe("stopped");
    host.stop();
  });

  it("reports created instances right away", async () => {
    const orchestrator = fakeOrchestrator({ desiredState: "ready" });
    let agent!: FleetAgent;
    const host = new InstanceHost({ sweepIntervalMs: 0, onInstancesChanged: () => agent?.reportSoon() });
    agent = new FleetAgent({ identity, orchestratorUrl: "http://o", host, fetch: orchestrator.fetch, intervalMs: 60_000 });
    await agent.start();
    const before = orchestrator.requests.length;

    host.createInstance("golem_dungeon");
    await new Promise((r) => setTimeout(r, 100));
    expect(orchestrator.requests.length).toBe(before + 1);
    expect(orchestrator.requests.at(-1)!.body.instances.map((i) => i.zoneId)).toContain("golem_dungeon");
    agent.halt();
    host.stop();
  });

  it("asks to drain when the orchestrator wants it", async () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    let drainRequests = 0;
    const orchestrator = fakeOrchestrator({ desiredState: "draining" });
    const agent = new FleetAgent({
      identity,
      orchestratorUrl: "http://o",
      host,
      fetch: orchestrator.fetch,
      onDrainRequested: () => drainRequests++,
    });
    await agent.start();
    expect(drainRequests).toBe(1);
    agent.halt();
    host.stop();
  });

  it("keeps running when the orchestrator is down", async () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    const warnings: string[] = [];
    const orchestrator = fakeOrchestrator({ desiredState: "ready", down: true });
    const agent = new FleetAgent({
      identity,
      orchestratorUrl: "http://o",
      host,
      fetch: orchestrator.fetch,
      log: (_level, message) => warnings.push(message),
    });
    await agent.start();
    expect(agent.currentState).toBe("ready");
    expect(warnings).toEqual(["Orchestrator unreachable at startup", "Heartbeat failed"]);
    agent.halt();
    host.stop();
  });

  it("knows whether the orchestrator is reachable", async () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    const answer = { desiredState: "ready", down: false };
    const orchestrator = fakeOrchestrator(answer);
    const agent = new FleetAgent({ identity, orchestratorUrl: "http://o", host, fetch: orchestrator.fetch, intervalMs: 20 });
    await agent.start();
    expect(agent.reachable).toBe(true);

    answer.down = true; // e.g. the region is cut off from the central cluster
    await new Promise((r) => setTimeout(r, 60));
    expect(agent.reachable).toBe(false);

    answer.down = false;
    await new Promise((r) => setTimeout(r, 60));
    expect(agent.reachable).toBe(true);
    agent.halt();
    host.stop();
  });
});
