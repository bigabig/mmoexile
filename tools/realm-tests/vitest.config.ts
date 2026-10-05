import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same throwaway Postgres + Redis setup as the instance server's tests.
    globalSetup: ["../../apps/instance-server/test/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Several realms in one process would share module-global ECS state.
    fileParallelism: false,
  },
});
