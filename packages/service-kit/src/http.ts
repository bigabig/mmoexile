import { randomUUID } from "node:crypto";
import {
  fastify,
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";
import type { ZodType } from "zod";
import type { Logger } from "./logger.js";

export interface HttpServiceOptions {
  logger: Logger;
  /** Readiness check for /ready, e.g. "database and Redis reachable". */
  isReady?: () => boolean | Promise<boolean>;
}

/** Header that carries the request ID across services (and in logs). */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * A Fastify instance with the conventions every service shares:
 * - zod schemas as route validators (`schema: { body: SomeZodSchema }`)
 * - a request ID taken from `x-request-id` or generated, echoed back
 * - `GET /health` (liveness: the process runs) and
 *   `GET /ready` (readiness: dependencies are reachable)
 */
export function createHttpService(
  options: HttpServiceOptions,
): FastifyInstance {
  const app = fastify({
    // pino's Logger and Fastify's logger type disagree on minor typings.
    loggerInstance: options.logger as unknown as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
  });

  // Validate request parts with zod schemas instead of JSON Schema.
  app.setValidatorCompiler(({ schema }) => (data) => {
    const result = (schema as unknown as ZodType).safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/ready", async (_request, reply) => {
    const ready = options.isReady ? await options.isReady() : true;
    return reply.code(ready ? 200 : 503).send({ ready });
  });

  return app;
}
