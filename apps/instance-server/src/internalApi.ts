import type { FastifyInstance } from "fastify";
import { createHttpService, type Logger, type Registry } from "@mmoexile/service-kit";
import { instanceServerApi } from "@mmoexile/contracts";
import { isZoneId } from "@mmoexile/game-core";
import type { InstanceHost } from "./cluster/index.js";

export interface InternalApiDeps {
  logger: Logger;
  host: InstanceHost;
  /** False while draining or stopping: no new instances. */
  acceptsInstances: () => boolean;
  /** Served on GET /metrics. */
  metrics?: Registry;
  /**
   * Awaited before answering a create: players will arrive (with Agones the
   * server becomes Allocated first, so it can't be scaled down meanwhile).
   */
  onInstanceCreated?: () => Promise<void>;
}

/**
 * The internal HTTP API on its own port, for the orchestrator (and metrics
 * scrapers). Clients only ever reach the public WebSocket port.
 */
export function buildInternalApi({
  logger,
  host,
  acceptsInstances,
  metrics,
  onInstanceCreated,
}: InternalApiDeps): FastifyInstance {
  const app = createHttpService({ logger, metrics });

  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
      const status = error.statusCode ?? (error.validation ? 400 : 500);
      if (status >= 500) logger.error({ err: error }, "Internal request failed");
      return reply
        .code(status)
        .send({ error: status >= 500 ? "Internal error" : error.message });
    },
  );

  // The orchestrator creates an instance here before sending players to it.
  app.post(
    instanceServerApi.createInstance.path,
    { schema: { body: instanceServerApi.createInstance.body } },
    async (request, reply) => {
      const body = request.body as {
        instanceId: string;
        zoneId: string;
        ownerPartyId?: string;
        boundPortalKey?: string;
      };
      if (!isZoneId(body.zoneId)) {
        return reply.code(400).send({ error: `Unknown zone ${body.zoneId}` });
      }
      if (!acceptsInstances()) {
        return reply.code(409).send({ error: "Server is draining" });
      }
      if (host.getInstance(body.instanceId)) {
        return reply.code(409).send({ error: "Instance exists" });
      }
      host.createInstance(body.zoneId, {
        id: body.instanceId,
        ownerPartyId: body.ownerPartyId,
        boundPortalKey: body.boundPortalKey,
      });
      await onInstanceCreated?.();
      logger.info({ instanceId: body.instanceId }, "Instance created for the orchestrator");
      return { instanceId: body.instanceId };
    },
  );

  return app;
}
