import type { FastifyInstance } from "fastify";
import { directoryApi, type RealmInfo } from "@mmoexile/contracts";
import { createHttpService, createMetrics, type Logger } from "@mmoexile/service-kit";
import type { Config } from "./config.js";

export interface DirectoryDeps {
  config: Pick<Config, "REALM_ID" | "REALM_NAME" | "ACCOUNT_API_URL" | "REGIONS" | "CACHE_MAX_AGE_SEC">;
  logger: Logger;
}

/**
 * The global directory: which realms exist and which regions each has.
 * Stateless and configured by environment; one realm for now.
 */
export function buildDirectory({ config, logger }: DirectoryDeps): FastifyInstance {
  const app = createHttpService({ logger, metrics: createMetrics("directory") });

  const realms: RealmInfo[] = [
    {
      id: config.REALM_ID,
      name: config.REALM_NAME,
      accountApiUrl: config.ACCOUNT_API_URL,
      regions: config.REGIONS,
    },
  ];

  app.get(directoryApi.listRealms.path, async (_request, reply) =>
    reply
      .header("cache-control", `public, max-age=${config.CACHE_MAX_AGE_SEC}`)
      .header("access-control-allow-origin", "*")
      .send({ realms }),
  );

  // Fallback ping target for setups without gateways (`pnpm dev`): the
  // directory then stands in for the single local region.
  app.get("/ping", async (_request, reply) =>
    reply
      .code(204)
      .header("cache-control", "no-store")
      .header("access-control-allow-origin", "*")
      .send(),
  );

  return app;
}
