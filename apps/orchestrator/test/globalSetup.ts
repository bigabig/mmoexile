import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";

/** A throwaway Redis for the test run, or TEST_REDIS_URL if set. */
let container: StartedRedisContainer | undefined;

export async function setup(): Promise<void> {
  if (!process.env.TEST_REDIS_URL) {
    container = await new RedisContainer("redis:7").start();
    process.env.TEST_REDIS_URL = container.getConnectionUrl();
  }
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
