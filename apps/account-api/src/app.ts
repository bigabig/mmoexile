import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@mmoexile/db";
import {
  generateSecret,
  hashSecret,
  secretKey,
  signSessionToken,
  verifySessionToken,
  type SessionClaims,
} from "@mmoexile/auth";
import {
  accountApi,
  createHttpClient,
  HttpError,
  MAX_CHARACTERS_PER_ACCOUNT,
  orchestratorApi,
  type AllocateRequest,
  type AllocateResponse,
} from "@mmoexile/contracts";
import { Counter, createHttpService, createMetrics, type Logger } from "@mmoexile/service-kit";
import type { Config } from "./config.js";
import { newCharacterData, toSummary } from "./characters.js";

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: PrismaClient;
  /** Defaults to the orchestrator's POST /allocate at config.ORCHESTRATOR_URL. */
  allocate?: (request: AllocateRequest) => Promise<AllocateResponse>;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
  }
}

/** Where every login starts (see plan S1.9). */
const LOGIN_ZONE = "nexus";

export function buildApp({ config, logger, db, allocate }: AppDeps): FastifyInstance {
  const sessionKey = secretKey(config.SESSION_SECRET);
  const orchestrator = createHttpClient({ baseUrl: config.ORCHESTRATOR_URL });
  allocate ??= (request) => orchestrator(orchestratorApi.allocate, request);

  const metrics = createMetrics("account-api");
  const logins = new Counter({
    name: "mmoexile_logins_total",
    help: "Guest accounts created and sessions refreshed",
    labelNames: ["kind"],
    registers: [metrics],
  });
  const plays = new Counter({
    name: "mmoexile_play_requests_total",
    help: "/play requests by outcome",
    labelNames: ["result"],
    registers: [metrics],
  });

  const app = createHttpService({
    logger,
    metrics,
    isReady: async () => {
      await db.$queryRaw`SELECT 1`;
      return true;
    },
  });

  // Every error leaves the service as { error: string } (ErrorResponse).
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, _request, reply) => {
    const status = error.statusCode ?? (error.validation ? 400 : 500);
    if (status >= 500) logger.error({ err: error }, "Request failed");
    return reply
      .code(status)
      .send({ error: status >= 500 ? "Internal error" : error.message });
  });

  const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return reply.code(401).send({ error: "Missing session token" });
    try {
      request.session = await verifySessionToken(token, sessionKey);
    } catch {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }
  };

  const issueSession = (accountId: string, nickname: string) =>
    signSessionToken({ accountId, nickname }, sessionKey);

  // --- Auth ---

  app.post(
    accountApi.guestLogin.path,
    { schema: { body: accountApi.guestLogin.body } },
    async (request) => {
      const { nickname } = request.body as { nickname: string };
      const refreshSecret = generateSecret();
      const account = await db.account.create({
        data: { nickname, refreshSecretHash: hashSecret(refreshSecret) },
      });
      logins.inc({ kind: "guest" });
      return {
        accountId: account.id,
        nickname: account.nickname,
        sessionToken: await issueSession(account.id, account.nickname),
        refreshSecret,
      };
    },
  );

  app.post(
    accountApi.refresh.path,
    { schema: { body: accountApi.refresh.body } },
    async (request, reply) => {
      const { refreshSecret } = request.body as { refreshSecret: string };
      const account = await db.account.findUnique({
        where: { refreshSecretHash: hashSecret(refreshSecret) },
      });
      if (!account) return reply.code(401).send({ error: "Unknown account" });
      logins.inc({ kind: "refresh" });
      return {
        accountId: account.id,
        nickname: account.nickname,
        sessionToken: await issueSession(account.id, account.nickname),
      };
    },
  );

  // --- Characters ---

  app.get(
    accountApi.listCharacters.path,
    { preHandler: requireSession },
    async (request) => {
      const characters = await db.character.findMany({
        where: { accountId: request.session!.accountId },
        orderBy: { createdAt: "desc" },
      });
      return { characters: characters.map(toSummary) };
    },
  );

  app.post(
    accountApi.createCharacter.path,
    {
      preHandler: requireSession,
      schema: { body: accountApi.createCharacter.body },
    },
    async (request, reply) => {
      const { accountId, nickname } = request.session!;
      const { classId } = request.body as { classId: string };
      const alive = await db.character.count({
        where: { accountId, isAlive: true },
      });
      if (alive >= MAX_CHARACTERS_PER_ACCOUNT) {
        return reply.code(409).send({
          error: `You can have at most ${MAX_CHARACTERS_PER_ACCOUNT} living characters`,
        });
      }
      const character = await db.character.create({
        data: newCharacterData(accountId, nickname, classId),
      });
      return { character: toSummary(character) };
    },
  );

  app.delete(
    accountApi.deleteCharacter.path,
    { preHandler: requireSession },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { count } = await db.character.deleteMany({
        where: { id, accountId: request.session!.accountId },
      });
      if (count === 0) return reply.code(404).send({ error: "No such character" });
      return { deleted: true as const };
    },
  );

  // --- Play ---

  app.post(
    accountApi.play.path,
    { preHandler: requireSession, schema: { body: accountApi.play.body } },
    async (request, reply) => {
      const { accountId } = request.session!;
      const { characterId } = request.body as { characterId: string };
      const character = await db.character.findFirst({
        where: { id: characterId, accountId },
      });
      if (!character) return reply.code(404).send({ error: "No such character" });
      if (!character.isAlive) {
        return reply.code(409).send({ error: "This character is dead" });
      }

      // The orchestrator is the single ticket issuer.
      try {
        const allocation = await allocate({ zoneId: LOGIN_ZONE, characterId, accountId });
        logger.info({ characterId, ticketId: allocation.ticketId, serverId: allocation.serverId }, "Play");
        plays.inc({ result: "ok" });
        return { url: allocation.url, ticket: allocation.ticket };
      } catch (err) {
        logger.warn({ err, characterId }, "Allocation for login failed");
        const busy = err instanceof HttpError && err.status === 503;
        plays.inc({ result: busy ? "fleet_full" : "unavailable" });
        return reply.code(503).send({
          error: busy ? "All servers are full, try again soon" : "Game servers are unavailable",
        });
      }
    },
  );

  return app;
}
