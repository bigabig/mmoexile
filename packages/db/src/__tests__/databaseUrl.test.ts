import { describe, it, expect } from "vitest";
import { databaseUrl, DEFAULT_DATABASE_URL } from "../index.js";

const timeouts = "socket_timeout=5&pool_timeout=5";

describe("databaseUrl", () => {
  it("is DATABASE_URL, or the compose database, with timeouts", () => {
    expect(databaseUrl({})).toBe(`${DEFAULT_DATABASE_URL}?${timeouts}`);
    expect(databaseUrl({ DATABASE_URL: "postgresql://u:p@db:5432/x" })).toBe(`postgresql://u:p@db:5432/x?${timeouts}`);
    expect(databaseUrl({ DATABASE_URL: "postgresql://db/x", DATABASE_TIMEOUT_SEC: "2" }))
      .toBe("postgresql://db/x?socket_timeout=2&pool_timeout=2");
  });

  it("adds the pool size, keeping the other parameters as they are", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://u:p@db:5432/x", DATABASE_POOL_SIZE: "5" }))
      .toBe(`postgresql://u:p@db:5432/x?connection_limit=5&${timeouts}`);
    expect(databaseUrl({
      DATABASE_URL: "postgresql://u:p@pgbouncer:6432/x?sslmode=require&sslcert=/etc/ca/ca.crt&sslaccept=strict",
      DATABASE_POOL_SIZE: "3",
    })).toBe(`postgresql://u:p@pgbouncer:6432/x?sslmode=require&sslcert=/etc/ca/ca.crt&sslaccept=strict&connection_limit=3&${timeouts}`);
  });

  it("keeps what the URL sets itself", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://db/x?connection_limit=2&socket_timeout=9", DATABASE_POOL_SIZE: "5" }))
      .toBe("postgresql://db/x?connection_limit=2&socket_timeout=9&pool_timeout=5");
  });

  it("refuses values that aren't positive integers", () => {
    expect(() => databaseUrl({ DATABASE_POOL_SIZE: "0" })).toThrow(/DATABASE_POOL_SIZE must be a positive integer/);
    expect(() => databaseUrl({ DATABASE_TIMEOUT_SEC: "five" })).toThrow(/DATABASE_TIMEOUT_SEC must be a positive integer/);
  });
});
