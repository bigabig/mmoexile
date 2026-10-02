import type { FastifyInstance } from "fastify";
import { orchestratorApi } from "@mmoexile/contracts";
import { createHttpService, type Logger } from "@mmoexile/service-kit";
import type { Redis } from "@mmoexile/messaging";
import { Registry } from "./Registry.js";
import { RegistryMirror } from "./RegistryMirror.js";
import type { Config } from "./config.js";

export interface OrchestratorDeps {
  config: Pick<Config, "HEARTBEAT_INTERVAL_MS">;
  logger: Logger;
  redis: Redis;
  now?: () => number;
}

export interface Orchestrator {
  app: FastifyInstance;
  registry: Registry;
  /** Loads the Redis mirror and starts dead-server detection. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The fleet's brain: knows every instance server and instance, and decides
 * where new instances go. A single process; its state is rebuildable from
 * heartbeats, so restarting it never disconnects a player.
 */
export function createOrchestrator({
  config,
  logger,
  redis,
  now = Date.now,
}: OrchestratorDeps): Orchestrator {
  const registry = new Registry({
    now,
    deadAfterMs: config.HEARTBEAT_INTERVAL_MS * 3,
  });
  const mirror = new RegistryMirror(redis);
  let sweepTimer: NodeJS.Timeout | undefined;

  const app = createHttpService({
    logger,
    isReady: async () => (await redis.ping()) === "PONG",
  });

  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
      const status = error.statusCode ?? (error.validation ? 400 : 500);
      if (status >= 500) logger.error({ err: error }, "Request failed");
      return reply
        .code(status)
        .send({ error: status >= 500 ? "Internal error" : error.message });
    },
  );

  app.get(orchestratorApi.listServers.path, async () => ({
    servers: registry.all().map((s) => registry.view(s)),
  }));

  const sweep = () => {
    for (const dead of registry.sweep()) {
      logger.warn({ serverId: dead.serverId }, "Instance server missed its heartbeats, marked dead");
      void mirror.remove(dead.serverId).catch(() => {});
    }
  };

  return {
    app,
    registry,
    async start() {
      const restored = await mirror.load();
      registry.restore(restored);
      if (restored.length > 0) {
        logger.info({ servers: restored.map((s) => s.serverId) }, "Restored registry from Redis");
      }
      sweepTimer = setInterval(sweep, Math.max(config.HEARTBEAT_INTERVAL_MS / 2, 100));
      sweepTimer.unref();
    },
    async stop() {
      clearInterval(sweepTimer);
      await app.close();
    },
  };
}
