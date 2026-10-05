import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { InstanceHost } from "../cluster/index.js";
import { createHttpHandler } from "../http.js";

describe("HTTP introspection endpoints", () => {
  let server: http.Server | undefined;
  let host: InstanceHost | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    host?.stop();
  });

  async function start(debugEndpoints: boolean, now?: () => number) {
    host = new InstanceHost({ sweepIntervalMs: 0, now });
    server = http.createServer(
      createHttpHandler(host, { debugEndpoints, now }),
    );
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    return { host, base: `http://127.0.0.1:${port}` };
  }

  it("/health reports instance and player counts", async () => {
    const { host, base } = await start(false);
    host.registerPlayer({ playerId: "a", name: "A" });
    host.registerPlayer({ playerId: "b", name: "B" });
    host.transferPlayer("b", "overworld");

    const body = await (await fetch(`${base}/health`)).json();

    expect(body).toMatchObject({ status: "ok", instances: 2, players: 2 });
  });

  it("/debug/instances lists instances with zone, players, state and age", async () => {
    let clock = 1_000_000;
    const { host, base } = await start(true, () => clock);
    host.registerPlayer({ playerId: "a", name: "A" });
    clock += 42_000;

    const body = await (await fetch(`${base}/debug/instances`)).json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      zone: "nexus",
      state: "running",
      players: 1,
      ageSec: 42,
      emptyForSec: null,
    });
    expect(body[0].id).toMatch(/^nexus:/);
  });

  it("hides /debug endpoints when disabled", async () => {
    const { base } = await start(false);
    const res = await fetch(`${base}/debug/instances`);
    expect(res.status).toBe(404);
  });
});
