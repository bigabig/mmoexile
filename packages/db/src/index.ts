import { PrismaClient } from "../generated/index.js";

export type { Account, Character, Prisma } from "../generated/index.js";
export type { PrismaClient };

/** The docker-compose database (`pnpm db:up`), used when DATABASE_URL is unset. */
export const DEFAULT_DATABASE_URL =
  "postgresql://mmoexile:mmoexile@localhost:5432/mmoexile";

/**
 * The connection URL: DATABASE_URL, plus the size of this process'
 * connection pool from DATABASE_POOL_SIZE (Prisma's connection_limit).
 * Without it, Prisma opens up to 2 × CPU cores + 1 connections per process,
 * which on a big machine is more than Postgres allows in total; each
 * service sets its own (see "Connection budget" in infra/k8s/README.md).
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const poolSize = env.DATABASE_POOL_SIZE;
  if (!poolSize || /[?&]connection_limit=/.test(url)) return url;
  if (!/^[1-9]\d*$/.test(poolSize)) {
    throw new Error(`DATABASE_POOL_SIZE must be a positive integer, got "${poolSize}"`);
  }
  // Appended as text: re-serializing with URL would escape the other parameters
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${poolSize}`;
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
