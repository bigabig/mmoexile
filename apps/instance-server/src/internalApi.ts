import type { FastifyInstance } from "fastify";
import { createHttpService, type Logger } from "@mmoexile/service-kit";
import type { InstanceHost } from "./cluster/index.js";

export interface InternalApiDeps {
  logger: Logger;
  host: InstanceHost;
}

/**
 * The internal HTTP API on its own port, for the orchestrator (and metrics
 * scrapers). Clients only ever reach the public WebSocket port.
 */
export function buildInternalApi({ logger }: InternalApiDeps): FastifyInstance {
  const app = createHttpService({ logger });

  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
      const status = error.statusCode ?? (error.validation ? 400 : 500);
      if (status >= 500) logger.error({ err: error }, "Internal request failed");
      return reply
        .code(status)
        .send({ error: status >= 500 ? "Internal error" : error.message });
    },
  );

  return app;
}
