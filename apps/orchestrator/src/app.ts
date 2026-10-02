import type { FastifyInstance } from "fastify";
import { signTicket, ticketSigningKey } from "@mmoexile/auth";
import {
  orchestratorApi,
  type AllocateRequest,
  type HeartbeatBody,
  type ServerIdentity,
} from "@mmoexile/contracts";
import { createHttpService, type Logger } from "@mmoexile/service-kit";
import type { Redis } from "@mmoexile/messaging";
import { Registry } from "./Registry.js";
import { RegistryMirror } from "./RegistryMirror.js";
import { Allocator } from "./Allocator.js";
import { PlacementError, type PlacementWeights } from "./placement.js";
import { OrchestratorMetrics } from "./metrics.js";
import type { Config } from "./config.js";

export interface OrchestratorDeps {
  config: Pick<Config, "HEARTBEAT_INTERVAL_MS" | "TICKET_PRIVATE_KEY">;
  logger: Logger;
  redis: Redis;
  now?: () => number;
  /** Placement weights; defaults to DEFAULT_WEIGHTS. */
  weights?: PlacementWeights;
}

export interface Orchestrator {
  app: FastifyInstance;
  registry: Registry;
  allocator: Allocator;
  metrics: OrchestratorMetrics;
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
  weights,
}: OrchestratorDeps): Orchestrator {
  const registry = new Registry({
    now,
    deadAfterMs: config.HEARTBEAT_INTERVAL_MS * 3,
    // 3 s with the default 2 s interval; never below 1 s, so a server busy
    // for a moment (e.g. creating many instances) isn't skipped.
    staleAfterMs: Math.min(
      Math.max(config.HEARTBEAT_INTERVAL_MS * 1.5, 1000),
      config.HEARTBEAT_INTERVAL_MS * 3,
    ),
  });
  const mirror = new RegistryMirror(redis);
  const metrics = new OrchestratorMetrics(registry);
  const ticketKey = ticketSigningKey(config.TICKET_PRIVATE_KEY);
  ticketKey.catch(() => {}); // reported by start()
  // A fresh orchestrator knows no servers until their next heartbeat. Rather
  // than answering "fleet full" then, allocations wait up to two intervals.
  const startedAt = now();
  const warmup = async () => {
    while (
      !registry.all().some((s) => registry.acceptsPlayers(s)) &&
      now() - startedAt < config.HEARTBEAT_INTERVAL_MS * 2
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const allocator = new Allocator({
    registry,
    logger,
    weights,
    warmup,
    signTicket: async (claims) => signTicket(claims, await ticketKey),
    onAllocated: (ms, created) =>
      metrics.allocationDuration.observe({ created: String(created) }, ms / 1000),
  });
  let sweepTimer: NodeJS.Timeout | undefined;

  const app = createHttpService({
    logger,
    metrics: metrics.registry,
    isReady: async () => (await redis.ping()) === "PONG",
  });

  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
      const status = error.statusCode ?? (error.validation ? 400 : 500);
      if (error instanceof PlacementError) {
        // Expected (fleet full, unknown zone): no stack trace
        logger.warn({ status, reason: error.message }, "Allocation refused");
      } else if (status >= 500) {
        logger.error({ err: error }, "Request failed");
      }
      return reply
        .code(status)
        .send({ error: status >= 500 ? "Internal error" : error.message });
    },
  );

  const mirrorServer = (serverId: string) => {
    const entry = registry.get(serverId);
    if (entry) {
      mirror.save(registry.view(entry)).catch((err) =>
        logger.warn({ err }, "Could not mirror the registry to Redis"),
      );
    }
  };

  app.post(
    orchestratorApi.register.path,
    { schema: { body: orchestratorApi.register.body } },
    async (request) => {
      const identity = request.body as ServerIdentity;
      registry.register(identity);
      mirrorServer(identity.serverId);
      logger.info({ serverId: identity.serverId, url: identity.url }, "Instance server registered");
      return { heartbeatIntervalMs: config.HEARTBEAT_INTERVAL_MS };
    },
  );

  app.post(
    orchestratorApi.heartbeat.path,
    { schema: { body: orchestratorApi.heartbeat.body } },
    async (request, reply) => {
      const report = request.body as HeartbeatBody;
      const { id } = request.params as { id: string };
      if (id !== report.serverId) {
        return reply.code(400).send({ error: "Server ID in path and body differ" });
      }
      const known = registry.get(id);
      if (!known || known.state === "dead") {
        logger.info({ serverId: id, wasDead: known?.state === "dead" }, "Instance server (re)joined via heartbeat");
      }
      const previous = known?.state;
      const desiredState = registry.heartbeat(report);
      if (previous && previous !== report.state && report.state !== "ready") {
        logger.info({ serverId: id, state: report.state }, "Instance server changed state");
      }
      mirrorServer(id);
      return { desiredState };
    },
  );

  // Stop placing players on a server; it learns it with its next heartbeat,
  // moves its players away and stops.
  app.post(orchestratorApi.drain.path, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = registry.drain(id);
    if (!entry) return reply.code(404).send({ error: `Unknown server ${id}` });
    logger.info({ serverId: id, state: entry.state }, "Drain requested");
    mirrorServer(id);
    return { state: entry.state };
  });

  app.post(
    orchestratorApi.allocate.path,
    { schema: { body: orchestratorApi.allocate.body } },
    async (request) => {
      try {
        return await allocator.allocate(request.body as AllocateRequest);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        metrics.allocationFailures.inc({ status: String(status) });
        throw err;
      }
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
    allocator,
    metrics,
    async start() {
      await ticketKey; // fail fast on a malformed key
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
