import http from "http";
import type { AddressInfo } from "net";
import type { PrismaClient } from "@mmoexile/db";
import type { Broker, Redis } from "@mmoexile/messaging";
import { secretKey } from "@mmoexile/auth";
import { parseStaticPlacement, serverForZone } from "@mmoexile/contracts";
import type { Logger } from "@mmoexile/service-kit";
import { InstanceHost } from "./cluster/index.js";
import { WebSocketGateway } from "./gateway/index.js";
import { PersistenceService } from "./persistence/index.js";
import { PartyCache } from "./party/PartyCache.js";
import {
  SocialPartyDirectory,
  type PartyDirectory,
} from "./party/PartyDirectory.js";
import { RedisPresence, type Presence } from "./presence/Presence.js";
import { createHttpHandler } from "./http.js";
import { gracefulShutdown } from "./shutdown.js";
import { CharacterOwnership } from "./ownership/CharacterOwnership.js";
import { LeaseKeeper } from "./ownership/LeaseKeeper.js";
import { FencedCharacterWriter } from "./ownership/FencedCharacterWriter.js";
import { PlayerLifecycle } from "./players/PlayerLifecycle.js";
import type { Config } from "./config.js";

export interface InstanceServerDeps {
  config: Config;
  logger: Logger;
  db: PrismaClient;
  redis: Redis;
  broker: Broker;
  /** Defaults to the social service at config.SOCIAL_URL. */
  parties?: PartyDirectory;
  /** Defaults to Redis presence. */
  presence?: Presence;
}

export interface InstanceServer {
  readonly host: InstanceHost;
  readonly lifecycle: PlayerLifecycle;
  readonly gateway: WebSocketGateway;
  listen(port: number): Promise<number>;
  /** Saves and releases every character, then stops everything. */
  stop(): Promise<void>;
}

/** Wires one instance server process together (composition root). */
export async function createInstanceServer({
  config,
  logger,
  db,
  redis,
  broker,
  parties = new SocialPartyDirectory(config.SOCIAL_URL),
  presence = new RedisPresence(redis, config.SERVER_ID),
}: InstanceServerDeps): Promise<InstanceServer> {
  const placement = parseStaticPlacement(config.SERVERS, config.ZONE_PLACEMENT);
  const ticketKey = secretKey(config.TICKET_SECRET);
  const hostsZone = (zoneId: string) =>
    placement.zones.get(zoneId) === config.SERVER_ID;

  const ownership = new CharacterOwnership({
    redis,
    db,
    leaseTtlMs: config.LEASE_TTL_MS,
  });

  // Late-bound: the lifecycle and gateway need each other.
  let lifecycle!: PlayerLifecycle;
  let gateway!: WebSocketGateway;

  const leases = new LeaseKeeper(ownership, (characterId) =>
    lifecycle.dropFenced(characterId),
  );
  const persistence = new PersistenceService(
    new FencedCharacterWriter(ownership, leases, (characterId) =>
      lifecycle.dropFenced(characterId),
    ),
  );

  const partyCache = new PartyCache(broker);
  await partyCache.start();

  const host = new InstanceHost({
    persistence,
    hostsZone,
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    // Every zone change is a handoff with reconnect (decision D4).
    onPortalTransfer: (playerId, targetZoneId, via) => {
      lifecycle.handOff(playerId, targetZoneId, via).catch((err) =>
        logger.error({ err, playerId, targetZoneId }, "Handoff failed"),
      );
    },
  });

  lifecycle = new PlayerLifecycle({
    serverId: config.SERVER_ID,
    host,
    db,
    redis,
    broker,
    ownership,
    leases,
    placement,
    ticketKey,
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    onAdmitted: (player) => {
      void presence.set(player.characterId, player.name);
      parties
        .getParty(player.characterId)
        .then((party) => partyCache.seed(player.characterId, party))
        .catch((err) => logger.warn({ err }, "Could not load party"));
    },
    onDeparted: (characterId, name) => {
      void presence.remove(characterId, name);
    },
    sendReconnect: (...args) => gateway.sendReconnect(...args),
    kickSession: (...args) => gateway.kickSession(...args),
    log: (message, extra) => logger.info(extra ?? {}, message),
  });
  await lifecycle.start();
  leases.start();

  const httpServer = http.createServer(
    createHttpHandler(host, { debugEndpoints: config.NODE_ENV !== "production" }),
  );
  gateway = new WebSocketGateway(httpServer, host, lifecycle, {
    parties,
    partyCache,
    presence,
    broker,
  });
  await gateway.subscribeToSharedChat();

  // Keep presence entries of local players alive.
  const presenceTimer = setInterval(() => {
    for (const player of lifecycle.all()) {
      void presence.set(player.characterId, player.name);
    }
  }, 20_000);
  presenceTimer.unref();

  logger.info(
    {
      serverId: config.SERVER_ID,
      zones: [...placement.zones].filter(([, s]) => s === config.SERVER_ID).map(([z]) => z),
      nexus: serverForZone(placement, "nexus").serverId,
    },
    "Instance server ready",
  );

  return {
    host,
    lifecycle,
    gateway,
    listen: (port) =>
      new Promise((resolve) =>
        httpServer.listen(port, () =>
          resolve((httpServer.address() as AddressInfo).port),
        ),
      ),
    stop: async () => {
      clearInterval(presenceTimer);
      leases.stop();
      await gracefulShutdown({
        gateway,
        host,
        players: lifecycle,
        persistence,
        closeHttpServer: () =>
          new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
            httpServer.closeAllConnections();
          }),
        disconnectDatabase: async () => {},
      });
    },
  };
}
