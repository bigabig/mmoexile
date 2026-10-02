import type { FastifyInstance } from "fastify";
import { channels, socialApi } from "@mmoexile/contracts";
import type { Broker, Redis } from "@mmoexile/messaging";
import { createHttpService, type Logger } from "@mmoexile/service-kit";
import { PartyStore } from "./PartyStore.js";

export interface AppDeps {
  logger: Logger;
  redis: Redis;
  broker: Broker;
}

/**
 * Parties for the whole realm. Instance servers call this API when players
 * use party commands; every change is published as `party.updated`.
 */
export function buildApp({ logger, redis, broker }: AppDeps): FastifyInstance {
  const parties = new PartyStore(redis, (change) =>
    broker.publish(channels.partyUpdated, change),
  );

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

  app.post(socialApi.invite.path, { schema: { body: socialApi.invite.body } }, (req) => {
    const { inviterId, inviteeId } = req.body as { inviterId: string; inviteeId: string };
    return parties.invite(inviterId, inviteeId);
  });

  app.post(socialApi.accept.path, { schema: { body: socialApi.accept.body } }, (req) =>
    parties.accept((req.body as { characterId: string }).characterId),
  );

  app.post(socialApi.leave.path, { schema: { body: socialApi.leave.body } }, (req) =>
    parties.leave((req.body as { characterId: string }).characterId),
  );

  app.post(socialApi.getParty.path, { schema: { body: socialApi.getParty.body } }, async (req) => ({
    party: await parties.getParty((req.body as { characterId: string }).characterId),
  }));

  return app;
}
