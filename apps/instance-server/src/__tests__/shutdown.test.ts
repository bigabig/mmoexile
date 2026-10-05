import { describe, it, expect } from "vitest";
import { gracefulShutdown, type ShutdownSteps } from "../shutdown.js";

function recordingSteps(overrides: Partial<ShutdownSteps> = {}) {
  const calls: string[] = [];
  const steps: ShutdownSteps = {
    gateway: {
      close: () => calls.push("gateway.close"),
      disconnectAll: () => calls.push("gateway.disconnectAll"),
    },
    host: {
      prepareShutdown: () => calls.push("host.prepareShutdown"),
      stop: () => calls.push("host.stop"),
    },
    players: {
      shutdown: async () => {
        calls.push("players.shutdown");
      },
    },
    persistence: {
      stop: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push("persistence.stop");
      },
    },
    closeHttpServer: async () => {
      calls.push("closeHttpServer");
    },
    disconnectDatabase: async () => {
      calls.push("disconnectDatabase");
    },
    ...overrides,
  };
  return { calls, steps };
}

describe("gracefulShutdown", () => {
  it("snapshots and flushes players before destroying instances", async () => {
    const { calls, steps } = recordingSteps();

    await gracefulShutdown(steps);

    expect(calls).toEqual([
      "gateway.close",
      "host.prepareShutdown",
      "players.shutdown",
      "persistence.stop",
      "host.stop",
      "gateway.disconnectAll",
      "closeHttpServer",
      "disconnectDatabase",
    ]);
  });

  it("does not destroy instances when the final flush fails", async () => {
    const { calls, steps } = recordingSteps({
      persistence: {
        stop: async () => {
          throw new Error("database unreachable");
        },
      },
    });

    await expect(gracefulShutdown(steps)).rejects.toThrow(
      "database unreachable",
    );
    expect(calls).toEqual([
      "gateway.close",
      "host.prepareShutdown",
      "players.shutdown",
    ]);
  });
});
