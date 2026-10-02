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
import { PartyService } from "./party/PartyService.js";
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

  const parties = new PartyService();
  const host = new InstanceHost({
    persistence,
    hostsZone,
    getPartyId: (characterId) => parties.getPartyId(characterId),
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
    getPartyId: (characterId) => parties.getPartyId(characterId),
    sendReconnect: (...args) => gateway.sendReconnect(...args),
    kickSession: (...args) => gateway.kickSession(...args),
    log: (message, extra) => logger.info(extra ?? {}, message),
  });
  await lifecycle.start();
  leases.start();

  const httpServer = http.createServer(
    createHttpHandler(host, { debugEndpoints: config.NODE_ENV !== "production" }),
  );
  gateway = new WebSocketGateway(httpServer, host, parties, lifecycle);

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
