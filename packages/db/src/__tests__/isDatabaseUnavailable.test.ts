import { describe, it, expect } from "vitest";
import { Prisma } from "../../generated/index.js";
import { DatabaseTimeoutError, isDatabaseUnavailable, withDatabaseTimeout } from "../index.js";

const known = (code: string, message = "failed") =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "6" });

describe("isDatabaseUnavailable", () => {
  it("recognizes an unreachable, timed-out or overloaded database", () => {
    expect(isDatabaseUnavailable(known("P1001", "Can't reach database server"))).toBe(true);
    expect(isDatabaseUnavailable(known("P2024", "Timed out fetching a new connection from the connection pool"))).toBe(true);
    // As seen through PgBouncer while Postgres was paused
    expect(isDatabaseUnavailable(known("P2010", "Raw query failed. Code: `08P01`. Message: `FATAL: query_wait_timeout`"))).toBe(true);
    expect(isDatabaseUnavailable(new Prisma.PrismaClientUnknownRequestError(
      "Error occurred during query execution: ConnectorError(ConnectorError { kind: QueryError(Error { kind: Closed }) })",
      { clientVersion: "6" },
    ))).toBe(true);
    expect(isDatabaseUnavailable(new Prisma.PrismaClientInitializationError("Can't reach database server", "6"))).toBe(true);
  });

  it("doesn't retry errors that would repeat", () => {
    expect(isDatabaseUnavailable(known("P2002", "Unique constraint failed on the fields: (`refreshSecretHash`)"))).toBe(false);
    expect(isDatabaseUnavailable(known("P2025", "Record to update not found."))).toBe(false);
    expect(isDatabaseUnavailable(new Error("Timed out"))).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});

describe("withDatabaseTimeout", () => {
  it("passes results and errors through", async () => {
    expect(await withDatabaseTimeout(Promise.resolve(1), 100)).toBe(1);
    await expect(withDatabaseTimeout(Promise.reject(new Error("boom")), 100)).rejects.toThrow("boom");
  });

  it("stops waiting for a hanging operation, as an unavailable database", async () => {
    const err = await withDatabaseTimeout(new Promise(() => {}), 20).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseTimeoutError);
    expect(isDatabaseUnavailable(err)).toBe(true);
  });
});
