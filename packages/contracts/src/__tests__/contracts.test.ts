import { describe, it, expect } from "vitest";
import {
  accountApi,
  channels,
  createHttpClient,
  HttpError,
  parseStaticPlacement,
  serverForZone,
} from "../index.js";

describe("static placement", () => {
  const placement = parseStaticPlacement(
    "a=ws://localhost:7001/ws, b=ws://localhost:7002/ws",
    "nexus:a,overworld:b,golem_dungeon:b",
  );

  it("maps zones to server URLs", () => {
    expect(serverForZone(placement, "nexus")).toEqual({
      serverId: "a",
      url: "ws://localhost:7001/ws",
    });
    expect(serverForZone(placement, "golem_dungeon").serverId).toBe("b");
  });

  it("rejects zones placed on unknown servers and malformed entries", () => {
    expect(() => parseStaticPlacement("a=ws://x", "nexus:z")).toThrow(/unknown server/);
    expect(() => parseStaticPlacement("a", "nexus:a")).toThrow(/Invalid entry/);
    expect(() => serverForZone(placement, "moon")).toThrow(/No server/);
  });
});

describe("createHttpClient", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("sends JSON with the bearer token and validates the response", async () => {
    const { fn, calls } = fakeFetch(200, { url: "ws://x", ticket: "t" });
    const call = createHttpClient({ baseUrl: "http://api", token: () => "tok", fetch: fn });

    const result = await call(accountApi.play, { characterId: "c1" });

    expect(result).toEqual({ url: "ws://x", ticket: "t" });
    expect(calls[0].url).toBe("http://api/play");
    expect((calls[0].init.headers as any).authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ characterId: "c1" });
  });

  it("rejects responses that break the contract", async () => {
    const { fn } = fakeFetch(200, { url: 42 });
    const call = createHttpClient({ baseUrl: "http://api", fetch: fn });
    await expect(call(accountApi.play, { characterId: "c1" })).rejects.toThrow();
  });

  it("turns error bodies into HttpError", async () => {
    const { fn } = fakeFetch(409, { error: "character is dead" });
    const call = createHttpClient({ baseUrl: "http://api", fetch: fn });
    const err = await call(accountApi.play, { characterId: "c1" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, message: "character is dead" });
  });
});

describe("broker channels", () => {
  it("validates messages", () => {
    expect(
      channels.sessionKick.schema.safeParse({
        characterId: "c1",
        reason: "logged_in_elsewhere",
      }).success,
    ).toBe(true);
    expect(
      channels.sessionKick.schema.safeParse({ characterId: "c1", reason: "bored" })
        .success,
    ).toBe(false);
  });
});
