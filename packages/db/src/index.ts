import { PrismaClient } from "@prisma/client";

export type { Account, Character, Prisma } from "@prisma/client";

// Global singleton to prevent connection leaks across hot-reloads
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
