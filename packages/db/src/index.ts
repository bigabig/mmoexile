import { Prisma, PrismaClient } from "../generated/index.js";

export type { Account, Character } from "../generated/index.js";
export { Prisma, PrismaClient };

/** The docker-compose database (`pnpm db:up`), used when DATABASE_URL is unset. */
export const DEFAULT_DATABASE_URL =
  "postgresql://mmoexile:mmoexile@localhost:5432/mmoexile";

/**
 * The connection URL: DATABASE_URL plus, unless it sets them itself,
 * - the size of this process' connection pool from DATABASE_POOL_SIZE
 *   (Prisma's connection_limit). Without it, Prisma opens up to
 *   2 × CPU cores + 1 connections per process, which on a big machine is
 *   more than Postgres allows in total; each service sets its own (see
 *   "Connection budget" in infra/k8s/README.md);
 * - timeouts (DATABASE_TIMEOUT_SEC, default 5): a query that gets no answer
 *   (socket_timeout) or no free connection (pool_timeout) fails instead of
 *   hanging, e.g. while the database is down.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  let url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const add = (name: string, value: string | undefined, envName: string) => {
    if (!value || new RegExp(`[?&]${name}=`).test(url)) return;
    if (!/^[1-9]\d*$/.test(value)) {
      throw new Error(`${envName} must be a positive integer, got "${value}"`);
    }
    // Appended as text: re-serializing with URL would escape the other parameters
    url = `${url}${url.includes("?") ? "&" : "?"}${name}=${value}`;
  };
  add("connection_limit", env.DATABASE_POOL_SIZE, "DATABASE_POOL_SIZE");
  const timeout = env.DATABASE_TIMEOUT_SEC ?? "5";
  add("socket_timeout", timeout, "DATABASE_TIMEOUT_SEC");
  add("pool_timeout", timeout, "DATABASE_TIMEOUT_SEC");
  return url;
}

// Prisma's codes for "can't reach / timed out / connection lost / no free
// connection", and Postgres' SQLSTATE classes for connection problems (08)
// and shutdowns (57P0x), e.g. PgBouncer's query_wait_timeout
const UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const UNAVAILABLE_MESSAGE =
  /Code: `(08\w{3}|57P0\d)`|ConnectorError|Can't reach database|Server has closed the connection|Timed out|connection (pool|refused|reset)|socket|TLS/i;

/** A database operation didn't finish in time (withDatabaseTimeout). */
export class DatabaseTimeoutError extends Error {
  constructor(ms: number) {
    super(`Database operation timed out after ${ms} ms`);
    this.name = "DatabaseTimeoutError";
  }
}

/**
 * Fails after `ms` if the operation hasn't finished. Prisma's socket_timeout
 * covers a query on an open connection, but not everything: a statement
 * that has to be prepared first can hang while the database doesn't answer.
 * The operation itself keeps running; only the caller stops waiting.
 */
export function withDatabaseTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabaseTimeoutError(ms)), ms);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

/**
 * True if an error means the database is unavailable right now (down,
 * unreachable, overloaded), so the same operation may succeed later; false
 * for errors that would repeat (constraint violations, bugs).
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof DatabaseTimeoutError) return true;
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return UNAVAILABLE_CODES.has(err.code) || UNAVAILABLE_MESSAGE.test(err.message);
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return UNAVAILABLE_MESSAGE.test(err.message);
  }
  return false;
}

// Global singleton to prevent connection leaks across hot-reloads
export const prisma = new PrismaClient({
  datasourceUrl: databaseUrl(),
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
