import { describe, it, expect } from "vitest";
import { createRedis, redisOptions } from "../index.js";

describe("Redis client options", () => {
  it("are plain without a CA file (dev, compose)", () => {
    expect(redisOptions({})).toEqual({});
  });

  it("verify TLS against the CA file", () => {
    const read: string[] = [];
    const options = redisOptions({ caFile: "/etc/mmoexile/database-ca/ca.crt" }, (path) => {
      read.push(path);
      return Buffer.from("-----BEGIN CERTIFICATE-----");
    });
    expect(read).toEqual(["/etc/mmoexile/database-ca/ca.crt"]);
    expect(options.tls?.ca?.toString()).toBe("-----BEGIN CERTIFICATE-----");
  });

  it("fail early on a missing CA file", () => {
    expect(() => redisOptions({ caFile: "/nonexistent/ca.crt" })).toThrow(/ENOENT/);
  });

  it("connect with TLS for rediss:// URLs, with the user from the URL", () => {
    const redis = createRedis({ url: "rediss://mmoexile:secret@redis:6380" }, { lazyConnect: true });
    expect(redis.options.tls).toBeTruthy();
    expect(redis.options).toMatchObject({ host: "redis", port: 6380, username: "mmoexile", password: "secret" });
    redis.disconnect();
  });
});
