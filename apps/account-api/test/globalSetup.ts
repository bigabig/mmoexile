import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/**
 * Gives the test run its own database: a throwaway Postgres container, or
 * TEST_DATABASE_URL if set. Migrations are applied before any test runs.
 */
const dbPackageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db",
);

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("postgres:16").start();
    url = container.getConnectionUri();
  }

  execSync("pnpm exec prisma migrate deploy", {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  // Inherited by the test workers, which create the Prisma client.
  process.env.DATABASE_URL = url;
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
