import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";

/**
 * Gives the test run its own Postgres and Redis: throwaway containers, or
 * TEST_DATABASE_URL / TEST_REDIS_URL if set. Migrations are applied before
 * any test runs.
 */
const dbPackageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db",
);

let container: StartedPostgreSqlContainer | undefined;
let redisContainer: StartedRedisContainer | undefined;

export async function setup(): Promise<void> {
  let url = process.env.TEST_DATABASE_URL;
  const [postgres, redis] = await Promise.all([
    url ? undefined : new PostgreSqlContainer("postgres:16").start(),
    process.env.TEST_REDIS_URL ? undefined : new RedisContainer("redis:7").start(),
  ]);
  container = postgres;
  redisContainer = redis;
  url ??= postgres!.getConnectionUri();
  process.env.TEST_REDIS_URL ??= redis!.getConnectionUrl();

  execSync("pnpm exec prisma migrate deploy", {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  // Inherited by the test workers, which create the Prisma client.
  process.env.DATABASE_URL = url;
}

export async function teardown(): Promise<void> {
  await Promise.all([container?.stop(), redisContainer?.stop()]);
}
