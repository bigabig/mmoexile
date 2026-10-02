import { z } from "zod";

/**
 * HTTP API of apps/orchestrator, and the internal API every instance server
 * offers to it. Both are internal: never reachable by game clients.
 */

/**
 * starting → ready → draining → stopped. The orchestrator adds "dead" for
 * servers that stopped sending heartbeats. Maps 1:1 onto Agones later.
 */
export const ServerState = z.enum(["starting", "ready", "draining", "stopped", "dead"]);
export type ServerState = z.infer<typeof ServerState>;

export const InstanceReport = z.object({
  id: z.string(),
  zoneId: z.string(),
  /** Party owning a party_private instance. */
  ownerPartyId: z.string().optional(),
  /** Portal a portal_bound instance belongs to. */
  boundPortalKey: z.string().optional(),
  players: z.number().int().nonnegative(),
  state: z.string(),
});
export type InstanceReport = z.infer<typeof InstanceReport>;

/** Who a server is: sent on registration and with every heartbeat. */
export const ServerIdentity = z.object({
  serverId: z.string().min(1),
  /** Client-facing WebSocket URL. */
  url: z.string(),
  /** Internal HTTP base URL (instance creation, metrics). */
  internalUrl: z.string(),
  region: z.string().default("local"),
  /** Players this server should hold at most. */
  capacity: z.number().int().positive(),
});
export type ServerIdentity = z.infer<typeof ServerIdentity>;

export const HeartbeatBody = ServerIdentity.extend({
  state: ServerState.exclude(["dead"]),
  instances: z.array(InstanceReport),
  /** 95th percentile tick duration over the last interval, across instances. */
  tickP95Ms: z.number().nonnegative(),
  /** Process CPU usage since the last heartbeat, 0..1 per core. */
  cpu: z.number().nonnegative(),
  /**
   * Event loop utilization since the last heartbeat (0..1). All instances of
   * a server share one event loop; near 1 means ticks start late even when
   * each tick is fast, so this is the real "is this server full" signal.
   */
  eventLoopUtilization: z.number().min(0).max(1).default(0),
});
export type HeartbeatBody = z.infer<typeof HeartbeatBody>;

/** Portal used to enter a zone (portal_bound zones, logs). */
export const PortalVia = z.object({
  sourceInstanceId: z.string(),
  portalId: z.string(),
});

export const AllocateRequest = z.object({
  zoneId: z.string(),
  characterId: z.string(),
  accountId: z.string(),
  partyId: z.string().optional(),
  via: PortalVia.optional(),
  /** Join this public instance if it still has room. */
  preferInstanceId: z.string().optional(),
  /** Never place on this server (e.g. the one that is draining). */
  excludeServerId: z.string().optional(),
});
export type AllocateRequest = z.infer<typeof AllocateRequest>;

export const AllocateResponse = z.object({
  serverId: z.string(),
  instanceId: z.string(),
  url: z.string(),
  /** Transfer ticket for exactly this server and instance. */
  ticket: z.string(),
  ticketId: z.string(),
});
export type AllocateResponse = z.infer<typeof AllocateResponse>;

export const ServerView = ServerIdentity.extend({
  state: ServerState,
  players: z.number().int(),
  instances: z.array(InstanceReport),
  tickP95Ms: z.number(),
  cpu: z.number(),
  eventLoopUtilization: z.number(),
  lastHeartbeatAgoMs: z.number(),
});
export type ServerView = z.infer<typeof ServerView>;

export const orchestratorApi = {
  register: {
    method: "POST",
    path: "/servers/register",
    body: ServerIdentity,
    response: z.object({ heartbeatIntervalMs: z.number().int().positive() }),
  },
  /**
   * Path: /servers/<id>/heartbeat. Also registers unknown servers, so the
   * registry is rebuilt from heartbeats after an orchestrator restart. The
   * response tells the server the state the orchestrator wants (draining).
   */
  heartbeat: {
    method: "POST",
    path: "/servers/:id/heartbeat",
    body: HeartbeatBody,
    response: z.object({ desiredState: ServerState }),
  },
  /** Path: /servers/<id>/drain. No new allocations; the server empties itself. */
  drain: {
    method: "POST",
    path: "/servers/:id/drain",
    body: z.undefined(),
    response: z.object({ state: ServerState }),
  },
  listServers: {
    method: "GET",
    path: "/servers",
    body: z.undefined(),
    response: z.object({ servers: z.array(ServerView) }),
  },
  /** Finds or creates an instance for a character and issues a ticket for it. */
  allocate: {
    method: "POST",
    path: "/allocate",
    body: AllocateRequest,
    response: AllocateResponse,
  },
} as const;

/** Internal API of every instance server, called by the orchestrator. */
export const instanceServerApi = {
  createInstance: {
    method: "POST",
    path: "/internal/instances",
    body: z.object({
      instanceId: z.string(),
      zoneId: z.string(),
      ownerPartyId: z.string().optional(),
      boundPortalKey: z.string().optional(),
    }),
    response: z.object({ instanceId: z.string() }),
  },
} as const;
