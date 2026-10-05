import { describe, it, expect } from "vitest";
import { databaseUrl, DEFAULT_DATABASE_URL } from "../index.js";

describe("databaseUrl", () => {
  it("is DATABASE_URL, or the compose database", () => {
    expect(databaseUrl({})).toBe(DEFAULT_DATABASE_URL);
    expect(databaseUrl({ DATABASE_URL: "postgresql://u:p@db:5432/x" })).toBe("postgresql://u:p@db:5432/x");
  });

  it("adds the pool size, keeping the other parameters as they are", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://u:p@db:5432/x", DATABASE_POOL_SIZE: "5" }))
      .toBe("postgresql://u:p@db:5432/x?connection_limit=5");
    expect(databaseUrl({
      DATABASE_URL: "postgresql://u:p@pgbouncer:6432/x?sslmode=require&sslcert=/etc/ca/ca.crt&sslaccept=strict",
      DATABASE_POOL_SIZE: "3",
    })).toBe("postgresql://u:p@pgbouncer:6432/x?sslmode=require&sslcert=/etc/ca/ca.crt&sslaccept=strict&connection_limit=3");
  });

  it("keeps a connection_limit that is already in the URL", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://db/x?connection_limit=2", DATABASE_POOL_SIZE: "5" }))
      .toBe("postgresql://db/x?connection_limit=2");
  });

  it("refuses a pool size that isn't a positive integer", () => {
    expect(() => databaseUrl({ DATABASE_POOL_SIZE: "0" })).toThrow(/positive integer/);
    expect(() => databaseUrl({ DATABASE_POOL_SIZE: "five" })).toThrow(/positive integer/);
  });
});
