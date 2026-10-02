import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  baseConfigSchema,
  createHttpService,
  createLogger,
  handleShutdownSignals,
  loadConfig,
} from "../index.js";

const silent = createLogger("test", "silent");

describe("loadConfig", () => {
  const schema = baseConfigSchema.extend({
    PORT: z.coerce.number().int().positive(),
  });

  it("parses and applies defaults", () => {
    const config = loadConfig(schema, { PORT: "3000" });
    expect(config).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      PORT: 3000,
    });
  });

  it("lists every invalid value", () => {
    expect(() =>
      loadConfig(schema, { PORT: "abc", LOG_LEVEL: "loud" }),
    ).toThrow(/Invalid configuration[\s\S]*PORT[\s\S]*LOG_LEVEL|Invalid configuration[\s\S]*LOG_LEVEL[\s\S]*PORT/);
  });
});

describe("createHttpService", () => {
  it("serves /health and a readiness check", async () => {
    let ready = false;
    const app = createHttpService({ logger: silent, isReady: () => ready });

    expect((await app.inject("/health")).json()).toMatchObject({ status: "ok" });
    expect((await app.inject("/ready")).statusCode).toBe(503);
    ready = true;
    expect((await app.inject("/ready")).statusCode).toBe(200);
    await app.close();
  });

  it("validates request bodies with zod schemas", async () => {
    const app = createHttpService({ logger: silent });
    app.post(
      "/echo",
      { schema: { body: z.object({ name: z.string().min(1) }) } },
      async (request) => request.body,
    );

    const ok = await app.inject({ method: "POST", url: "/echo", payload: { name: "Ann" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ name: "Ann" });

    const bad = await app.inject({ method: "POST", url: "/echo", payload: { name: "" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("propagates or generates a request id", async () => {
    const app = createHttpService({ logger: silent });
    const given = await app.inject({
      url: "/health",
      headers: { "x-request-id": "abc-123" },
    });
    expect(given.headers["x-request-id"]).toBe("abc-123");

    const generated = await app.inject("/health");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});

describe("handleShutdownSignals", () => {
  it("runs shutdown once and exits with 0", async () => {
    const exit = vi.fn();
    const shutdown = vi.fn(async () => {});
    const trigger = handleShutdownSignals({ logger: silent, shutdown, exit });

    await Promise.all([trigger(), trigger()]);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with 1 when shutdown fails", async () => {
    const exit = vi.fn();
    const trigger = handleShutdownSignals({
      logger: silent,
      shutdown: async () => {
        throw new Error("db down");
      },
      exit,
    });

    await trigger();

    expect(exit).toHaveBeenCalledWith(1);
  });
});
