import http from "http";
import type { AddressInfo } from "net";
import type { PrismaClient } from "@mmoexile/db";
import type { Broker, Redis } from "@mmoexile/messaging";
import { ticketVerificationKey } from "@mmoexile/auth";
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
import { buildInternalApi } from "./internalApi.js";
import { FleetAgent } from "./fleet/FleetAgent.js";
import { Drainer } from "./fleet/Drainer.js";
import {
  NO_ALLOCATOR,
  OrchestratorAllocator,
  type ZoneAllocator,
} from "./fleet/ZoneAllocator.js";
import { InstanceServerMetrics } from "./metrics.js";
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
  /** Defaults to the orchestrator at config.ORCHESTRATOR_URL. */
  allocator?: ZoneAllocator;
  /**
   * The orchestrator asked this server to drain (POST /servers/:id/drain).
   * main.ts drains, stops and exits, exactly like on SIGTERM.
   */
  onDrainRequested?: () => void;
}

export interface InstanceServer {
  readonly host: InstanceHost;
  readonly lifecycle: PlayerLifecycle;
  readonly gateway: WebSocketGateway;
  /** Link to the orchestrator; unset if ORCHESTRATOR_URL is empty. */
  readonly fleet: FleetAgent | undefined;
  /** Port of the internal API, once listening. */
  readonly internalPort: number | undefined;
  /** Opens the public and internal ports, then joins the fleet. */
  listen(port: number): Promise<number>;
  /** Moves players off this server (see Drainer); resolves when empty. */
  drain(): Promise<void>;
  readonly draining: boolean;
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
  allocator = config.ORCHESTRATOR_URL
    ? new OrchestratorAllocator(config.ORCHESTRATOR_URL)
    : NO_ALLOCATOR,
  onDrainRequested,
}: InstanceServerDeps): Promise<InstanceServer> {
  const ticketKey = await ticketVerificationKey(config.TICKET_PUBLIC_KEY);

  // Late-bound: metrics need the host, the host reports into metrics.
  let metrics!: InstanceServerMetrics;

  const ownership = new CharacterOwnership({
    redis,
    db,
    leaseTtlMs: config.LEASE_TTL_MS,
    onLeaseConflict: () => metrics.leaseConflicts.inc(),
    onFencedWrite: () => metrics.fencedWrites.inc(),
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

  let fleet: FleetAgent | undefined;
  let internalPort: number | undefined;

  const host = new InstanceHost({
    persistence,
    onInstancesChanged: () => fleet?.reportSoon(),
    onTickDuration: (ms) => metrics?.tickDuration.observe(ms / 1000),
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    // Every zone change is a handoff with reconnect (decision D4).
    onPortalTransfer: (playerId, targetZoneId, via) => {
      lifecycle.handOff(playerId, targetZoneId, via).catch((err) =>
        logger.error({ err, playerId, targetZoneId }, "Handoff failed"),
      );
    },
  });

  metrics = new InstanceServerMetrics(config.SERVER_ID, host);

  lifecycle = new PlayerLifecycle({
    serverId: config.SERVER_ID,
    host,
    db,
    redis,
    broker,
    ownership,
    leases,
    ticketKey,
    allocator,
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    onAdmitted: (player, ticket) => {
      metrics.handoffDuration.observe(
        { kind: player.arrivedViaPortal ? "zone_change" : "login" },
        Math.max(0, Date.now() - ticket.issuedAt) / 1000,
      );
      void presence.set(player.characterId, player.name);
      parties
        .getParty(player.characterId)
        .then((party) => partyCache.seed(player.characterId, party))
        .catch((err) => logger.warn({ err }, "Could not load party"));
    },
    onRejected: (reason) => metrics.ticketRejections.inc({ reason }),
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
  const internalApi = buildInternalApi({
    logger,
    host,
    metrics: metrics.registry,
    acceptsInstances: () => !fleet || fleet.currentState === "ready",
  });

  // Keep presence entries of local players alive.
  const presenceTimer = setInterval(() => {
    for (const player of lifecycle.all()) {
      void presence.set(player.characterId, player.name);
    }
  }, 20_000);
  presenceTimer.unref();

  logger.info(
    { serverId: config.SERVER_ID, orchestrator: config.ORCHESTRATOR_URL || null },
    "Instance server ready",
  );

  const drainer = new Drainer({
    host,
    lifecycle,
    get fleet() {
      return fleet;
    },
    timeoutMs: config.DRAIN_TIMEOUT_SEC * 1000,
    log: (message, extra) => logger.info(extra ?? {}, message),
  });

  const joinFleet = async (publicPort: number) => {
    if (!config.ORCHESTRATOR_URL) return;
    fleet = new FleetAgent({
      identity: {
        serverId: config.SERVER_ID,
        url: config.PUBLIC_URL ?? `ws://localhost:${publicPort}/ws`,
        internalUrl: config.INTERNAL_URL ?? `http://localhost:${internalPort}`,
        region: config.REGION,
        capacity: config.CAPACITY,
      },
      orchestratorUrl: config.ORCHESTRATOR_URL,
      host,
      intervalMs: config.HEARTBEAT_INTERVAL_MS,
      onDrainRequested: () => {
        logger.info("The orchestrator asked this server to drain");
        if (onDrainRequested) onDrainRequested();
        else void drainer.drain();
      },
      log: (level, message, extra) => logger[level](extra ?? {}, message),
    });
    await fleet.start();
  };

  return {
    host,
    lifecycle,
    gateway,
    get fleet() {
      return fleet;
    },
    get internalPort() {
      return internalPort;
    },
    listen: async (port) => {
      const publicPort = await new Promise<number>((resolve) =>
        httpServer.listen(port, () =>
          resolve((httpServer.address() as AddressInfo).port),
        ),
      );
      await internalApi.listen({ port: config.INTERNAL_PORT, host: "0.0.0.0" });
      internalPort = (internalApi.server.address() as AddressInfo).port;
      await joinFleet(publicPort);
      return publicPort;
    },
    drain: () => drainer.drain(),
    get draining() {
      return drainer.active;
    },
    stop: async () => {
      clearInterval(presenceTimer);
      // No new allocations while players are saved and kicked.
      await fleet?.setState("draining");
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
      await fleet?.stop();
      await internalApi.close();
    },
  };
}
