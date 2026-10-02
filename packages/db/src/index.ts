import { PrismaClient } from "@prisma/client";

export type { Account, Character, Prisma, PrismaClient } from "@prisma/client";

/** The docker-compose database (`pnpm db:up`), used when DATABASE_URL is unset. */
export const DEFAULT_DATABASE_URL =
  "postgresql://mmoexile:mmoexile@localhost:5432/mmoexile";

// Global singleton to prevent connection leaks across hot-reloads
export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
