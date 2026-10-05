import http from "http";
import type { AddressInfo } from "net";
import { isDatabaseUnavailable, type PrismaClient } from "@mmoexile/db";
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
import { AgonesSdk } from "./fleet/AgonesSdk.js";
import { AgonesLifecycle, publicUrlFor } from "./fleet/AgonesLifecycle.js";
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
  /** LIFECYCLE=agones: defaults to the SDK sidecar on localhost. */
  agonesSdk?: AgonesSdk;
  /**
   * The orchestrator asked this server to drain (POST /servers/:id/drain).
   * main.ts drains, stops and exits, exactly like on SIGTERM.
   */
  onDrainRequested?: () => void;
}

export interface InstanceServer {
  readonly host: InstanceHost;
  readonly lifecycle: PlayerLifecycle;
  /** Character saves (retried while the database is unavailable). */
  readonly persistence: PersistenceService;
  readonly gateway: WebSocketGateway;
  /** Link to the orchestrator; unset if ORCHESTRATOR_URL is empty. */
  readonly fleet: FleetAgent | undefined;
  /** Link to Agones; set with LIFECYCLE=agones. */
  readonly agones: AgonesLifecycle | undefined;
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
  agonesSdk,
  onDrainRequested,
}: InstanceServerDeps): Promise<InstanceServer> {
  const ticketKey = await ticketVerificationKey(config.TICKET_PUBLIC_KEY);

  // Late-bound: metrics need the host, the host reports into metrics.
  let metrics!: InstanceServerMetrics;

  const ownership = new CharacterOwnership({
    redis,
    db,
    leaseTtlMs: config.LEASE_TTL_MS,
    // A little longer than Prisma's own timeouts, which usually fire first
    dbTimeoutMs: (config.DATABASE_TIMEOUT_SEC + 1) * 1000,
    onLeaseConflict: () => metrics.leaseConflicts.inc(),
    onFencedWrite: () => metrics.fencedWrites.inc(),
    onWriteDuration: (ms) => metrics?.writeDuration.observe(ms / 1000),
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
    {
      isTransient: isDatabaseUnavailable,
      onWriteFailed: (kind, err, retrying) => {
        metrics?.saveFailures.inc({ kind, retrying: String(retrying) });
        logger[retrying ? "warn" : "error"]({ err, kind }, retrying ? "Save failed, will retry" : "Save failed");
      },
    },
  );

  const partyCache = new PartyCache(broker);
  await partyCache.start();

  let fleet: FleetAgent | undefined;
  let internalPort: number | undefined;

  // Agones (LIFECYCLE=agones): Ready while empty, Allocated while in use
  const agonesClient =
    config.LIFECYCLE === "agones"
      ? (agonesSdk ?? new AgonesSdk({ baseUrl: `http://localhost:${config.AGONES_SDK_HTTP_PORT}` }))
      : undefined;
  const agones = agonesClient
    ? new AgonesLifecycle({
        sdk: agonesClient,
        players: () => lifecycle.all().length,
        capacity: config.CAPACITY,
        healthIntervalMs: config.HEARTBEAT_INTERVAL_MS,
        log: (level, message, extra) => logger[level](extra ?? {}, message),
      })
    : undefined;

  const host = new InstanceHost({
    persistence,
    onInstancesChanged: () => fleet?.reportSoon(),
    onTickDuration: (ms, intervalMs) => {
      metrics?.tickDuration.observe(ms / 1000);
      if (intervalMs !== undefined) metrics?.tickInterval.observe(intervalMs / 1000);
    },
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    // Every zone change is a handoff with reconnect (decision D4).
    onPortalTransfer: (playerId, targetZoneId, via) => {
      lifecycle.handOff(playerId, targetZoneId, via).catch((err) =>
        logger.error({ err, playerId, targetZoneId }, "Handoff failed"),
      );
    },
  });

  metrics = new InstanceServerMetrics(config.SERVER_ID, config.REGION, host, persistence);

  lifecycle = new PlayerLifecycle({
    serverId: config.SERVER_ID,
    region: config.REGION,
    host,
    db,
    redis,
    broker,
    ownership,
    leases,
    persistence,
    ticketKey,
    allocator,
    getPartyId: (characterId) => partyCache.getPartyId(characterId),
    getLeaderRegion: async (characterId) => {
      const party = partyCache.getParty(characterId);
      if (!party) return undefined;
      return lifecycle.get(party.leaderId)?.homeRegion ?? presence.homeRegionOf(party.leaderId);
    },
    onAdmitted: (player, ticket) => {
      metrics.handoffDuration.observe(
        {
          // Every handoff ticket names the region the player came from
          // (portals and drain moves alike); a login has none.
          kind: ticket.fromRegion !== undefined ? "zone_change" : "login",
          from_region: ticket.fromRegion ?? "none",
          to_region: config.REGION,
        },
        Math.max(0, Date.now() - ticket.issuedAt) / 1000,
      );
      presence.set(player).catch((err) => logger.warn({ err }, "Presence update failed"));
      void agones?.sync();
      parties
        .getParty(player.characterId)
        .then((party) => partyCache.seed(player.characterId, party))
        .catch((err) => logger.warn({ err }, "Could not load party"));
    },
    onRejected: (reason) => metrics.ticketRejections.inc({ reason }),
    onDeparted: (characterId, name) => {
      presence.remove(characterId, name).catch((err) => logger.warn({ err }, "Presence update failed"));
      void agones?.sync();
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
    onInstanceCreated: agones ? () => agones.hold() : undefined,
  });

  // Keep presence entries of local players alive.
  const presenceTimer = setInterval(() => {
    for (const player of lifecycle.all()) {
      presence.set(player).catch((err) => logger.warn({ err }, "Presence update failed"));
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

  // Draining (SIGTERM or the orchestrator): with Agones, the server keeps
  // its state until it shuts down, so it isn't removed while players leave.
  const drain = () => {
    agones?.freeze();
    return drainer.drain();
  };

  const joinFleet = async (publicPort: number) => {
    if (!config.ORCHESTRATOR_URL) return;
    // With Agones, players reach the host port it assigned on this node
    const publicUrl =
      config.PUBLIC_URL ??
      (agonesClient
        ? publicUrlFor(await agonesClient.gameServer(), config.PUBLIC_HOST)
        : `ws://localhost:${publicPort}/ws`);
    fleet = new FleetAgent({
      identity: {
        serverId: config.SERVER_ID,
        url: publicUrl,
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
        else drain().catch((err) => logger.error({ err }, "Drain failed"));
      },
      onHeartbeatAnswer: ({ hold }) => void agones?.setOrchestratorHold(hold),
      log: (level, message, extra) => logger[level](extra ?? {}, message),
    });
    await fleet.start();
    await agones?.start();
  };

  return {
    host,
    lifecycle,
    persistence,
    gateway,
    get fleet() {
      return fleet;
    },
    agones,
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
    drain,
    get draining() {
      return drainer.active;
    },
    stop: async () => {
      clearInterval(presenceTimer);
      // No new allocations while players are saved and kicked.
      await fleet?.setState("draining");
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
      // Only now: leases stay renewed while final saves wait for the database
      leases.stop();
      await fleet?.stop();
      await internalApi.close();
      // Agones deletes the GameServer (a Fleet then starts a fresh one)
      await agones?.shutdown().catch((err) => logger.warn({ err }, "Agones shutdown failed"));
    },
  };
}
