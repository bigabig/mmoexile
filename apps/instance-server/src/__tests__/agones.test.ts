import { describe, it, expect } from "vitest";
import { AgonesSdk, type GameServerInfo } from "../fleet/AgonesSdk.js";
import { AgonesLifecycle, desiredAgonesState, publicUrlFor } from "../fleet/AgonesLifecycle.js";
import { InstanceHost } from "../cluster/index.js";
import { FleetAgent } from "../fleet/FleetAgent.js";

/** Records SDK requests and answers like the sidecar does. */
function fakeSidecar() {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const fetch = (async (url: URL, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ method: init.method!, path: url.pathname, body });
    if (url.pathname === "/gameserver") {
      return Response.json({
        object_meta: { name: "instance-server-eu-x7k2p" },
        status: { state: "Ready", address: "172.22.0.2", ports: [{ name: "game", port: 7302 }] },
      });
    }
    return Response.json(url.pathname.startsWith("/v1beta1/counters/") ? { name: "players" } : {});
  }) as unknown as typeof globalThis.fetch;
  return { requests, sdk: new AgonesSdk({ baseUrl: "http://localhost:9358", fetch }) };
}

/** An SDK that only records which calls were made. */
function recordingSdk() {
  const calls: string[] = [];
  const sdk = {
    ready: async () => void calls.push("ready"),
    allocate: async () => void calls.push("allocate"),
    health: async () => void calls.push("health"),
    shutdown: async () => void calls.push("shutdown"),
    setCounter: async (name: string, values: { count?: number; capacity?: number }) =>
      void calls.push(`counter ${name} ${JSON.stringify(values)}`),
  } as unknown as AgonesSdk;
  return { calls, sdk };
}

describe("AgonesSdk", () => {
  it("speaks the SDK sidecar's REST API", async () => {
    const { requests, sdk } = fakeSidecar();
    await sdk.ready();
    await sdk.allocate();
    await sdk.health();
    await sdk.setCounter("players", { count: 3, capacity: 60 });
    await sdk.shutdown();
    expect(requests).toEqual([
      { method: "POST", path: "/ready", body: {} },
      { method: "POST", path: "/allocate", body: {} },
      { method: "POST", path: "/health", body: {} },
      // int64 as strings, as in the REST mapping of the gRPC API
      { method: "PATCH", path: "/v1beta1/counters/players", body: { count: "3", capacity: "60" } },
      { method: "POST", path: "/shutdown", body: {} },
    ]);
  });

  it("reads the GameServer's name, state, address and ports", async () => {
    const { sdk } = fakeSidecar();
    expect(await sdk.gameServer()).toEqual({
      name: "instance-server-eu-x7k2p",
      state: "Ready",
      address: "172.22.0.2",
      ports: [{ name: "game", port: 7302 }],
    });
  });

  it("fails on errors from the sidecar", async () => {
    const fetch = (async () => new Response("players Counter not found", { status: 500 })) as unknown as typeof globalThis.fetch;
    const sdk = new AgonesSdk({ baseUrl: "http://localhost:9358", fetch });
    await expect(sdk.setCounter("players", { count: 1 })).rejects.toThrow(/500 players Counter not found/);
  });
});

describe("publicUrlFor", () => {
  const server: GameServerInfo = {
    name: "gs",
    state: "Ready",
    address: "172.22.0.2",
    ports: [{ name: "metrics", port: 7300 }, { name: "game", port: 7302 }],
  };

  it("uses the game port on the node's address, or on the given host", () => {
    expect(publicUrlFor(server)).toBe("ws://172.22.0.2:7302/ws");
    expect(publicUrlFor(server, "localhost")).toBe("ws://localhost:7302/ws");
  });

  it("needs a port", () => {
    expect(() => publicUrlFor({ ...server, ports: [] })).toThrow(/no port/);
  });
});

describe("AgonesLifecycle", () => {
  it("is Allocated with players or a hold, Ready otherwise", () => {
    expect(desiredAgonesState(0, false)).toBe("Ready");
    expect(desiredAgonesState(1, false)).toBe("Allocated");
    expect(desiredAgonesState(0, true)).toBe("Allocated");
  });

  it("follows the player count and mirrors it in the players Counter", async () => {
    const { calls, sdk } = recordingSdk();
    let players = 0;
    const agones = new AgonesLifecycle({ sdk, players: () => players, capacity: 60, healthIntervalMs: 60_000 });

    await agones.start();
    expect(calls).toEqual(["counter players {\"capacity\":60}", "ready", "counter players {\"count\":0}"]);

    calls.length = 0;
    players = 2;
    await agones.sync();
    await agones.sync(); // nothing changed: no calls
    expect(calls).toEqual(["allocate", "counter players {\"count\":2}"]);

    calls.length = 0;
    players = 0;
    await agones.sync();
    expect(calls).toEqual(["ready", "counter players {\"count\":0}"]);
    expect(agones.currentState).toBe("Ready");
    agones.freeze();
  });

  it("stays Allocated while held, by the orchestrator or for a created instance", async () => {
    const { calls, sdk } = recordingSdk();
    let now = 0;
    const agones = new AgonesLifecycle({ sdk, players: () => 0, capacity: 60, holdMs: 15_000, now: () => now, healthIntervalMs: 60_000 });
    await agones.start();

    // The orchestrator sent a player here: hold until it says otherwise
    await agones.setOrchestratorHold(true);
    expect(agones.currentState).toBe("Allocated");
    await agones.setOrchestratorHold(false);
    expect(agones.currentState).toBe("Ready");

    // An instance was created for someone: hold for holdMs
    await agones.hold();
    expect(agones.currentState).toBe("Allocated");
    now = 14_000;
    await agones.setOrchestratorHold(false);
    expect(agones.currentState).toBe("Allocated");
    now = 15_001;
    await agones.setOrchestratorHold(false);
    expect(agones.currentState).toBe("Ready");
    expect(calls.filter((c) => c === "allocate" || c === "ready")).toEqual(["ready", "allocate", "ready", "allocate", "ready"]);
    agones.freeze();
  });

  it("keeps its state while draining, then shuts down", async () => {
    const { calls, sdk } = recordingSdk();
    let players = 1;
    const agones = new AgonesLifecycle({ sdk, players: () => players, capacity: 60, healthIntervalMs: 60_000 });
    await agones.start();
    expect(agones.currentState).toBe("Allocated");

    agones.freeze();
    players = 0; // players leave during the drain: not Ready (could be scaled down mid-drain)
    await agones.sync();
    expect(agones.currentState).toBe("Allocated");

    await agones.shutdown();
    expect(calls.at(-1)).toBe("shutdown");
  });

  it("pings health regularly", async () => {
    const { calls, sdk } = recordingSdk();
    const agones = new AgonesLifecycle({ sdk, players: () => 0, capacity: 60, healthIntervalMs: 20 });
    await agones.start();
    await new Promise((r) => setTimeout(r, 70));
    agones.freeze();
    expect(calls.filter((c) => c === "health").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps going when an update fails", async () => {
    const warnings: string[] = [];
    let failing = true;
    const sdk = {
      ...recordingSdk().sdk,
      ready: async () => {
        if (failing) throw new Error("sidecar not up yet");
      },
    } as unknown as AgonesSdk;
    const agones = new AgonesLifecycle({ sdk, players: () => 0, capacity: 60, healthIntervalMs: 60_000, log: (_l, m) => void warnings.push(m) });
    await agones.start();
    expect(warnings).toEqual(["Agones update failed"]);
    expect(agones.currentState).toBeUndefined();

    failing = false;
    await agones.sync();
    expect(agones.currentState).toBe("Ready");
    agones.freeze();
  });
});

describe("FleetAgent and the hold flag", () => {
  it("passes the orchestrator's hold flag on", async () => {
    const answers: boolean[] = [];
    let hold = true;
    const fetch = (async (url: string) =>
      Response.json(url.endsWith("/register") ? { heartbeatIntervalMs: 2000 } : { desiredState: "ready", hold })) as unknown as typeof globalThis.fetch;
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    const agent = new FleetAgent({
      identity: { serverId: "s1", url: "ws://x/ws", internalUrl: "http://x", region: "eu", capacity: 60 },
      orchestratorUrl: "http://o",
      host,
      fetch,
      intervalMs: 60_000,
      onHeartbeatAnswer: (answer) => void answers.push(answer.hold),
    });
    await agent.start();
    hold = false;
    await agent.setState("draining");
    expect(answers).toEqual([true, false]);
    await agent.stop();
    host.stop();
  });
});
