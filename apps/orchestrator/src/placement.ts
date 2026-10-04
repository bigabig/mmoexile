import {
  portalKey,
  soloPartyId,
  type ZoneDefinition,
} from "@mmoexile/game-core";
import type { ServerState } from "@mmoexile/contracts";

/**
 * Placement rules, free of I/O so they are easy to test and replace:
 * which existing instance a character joins (the zone's access policy,
 * applied across the whole fleet), and which server gets a new instance.
 */

export interface PlacementWeights {
  /** One instance costs as much as this many players (memory, tick time). */
  instanceWeight: number;
  /** Tick p95 above this budget makes a server less attractive… */
  tickBudgetMs: number;
  /** …by this many "players" per millisecond over budget. */
  tickPenaltyPerMs: number;
  /** Event loop utilization above this makes a server less attractive… */
  eluBudget: number;
  /** …by this many "players" per 0.01 over budget. */
  eluPenaltyPerPercent: number;
}

export const DEFAULT_WEIGHTS: PlacementWeights = {
  instanceWeight: 5,
  tickBudgetMs: 20,
  tickPenaltyPerMs: 10,
  eluBudget: 0.6,
  eluPenaltyPerPercent: 5,
};

export interface ServerCandidate {
  serverId: string;
  state: ServerState;
  capacity: number;
  /** Players inside plus players on their way. */
  players: number;
  instances: number;
  tickP95Ms: number;
  /** 0..1, see HeartbeatBody. */
  eventLoopUtilization?: number;
}

export interface InstanceCandidate {
  id: string;
  serverId: string;
  zoneId: string;
  /** Players inside plus players on their way. */
  players: number;
  ownerPartyId?: string;
  boundPortalKey?: string;
}

export interface PlacementRequest {
  characterId: string;
  partyId?: string;
  via?: { sourceInstanceId: string; portalId: string };
  preferInstanceId?: string;
}

/**
 * Lower is better: players, plus instances, plus penalties for slow ticks
 * and for a busy event loop (many instances each ticking fast can still
 * saturate the one thread they share).
 */
export function serverScore(
  server: Pick<ServerCandidate, "players" | "instances" | "tickP95Ms" | "eventLoopUtilization">,
  weights: PlacementWeights = DEFAULT_WEIGHTS,
): number {
  const tickOver = Math.max(0, server.tickP95Ms - weights.tickBudgetMs);
  const eluOver = Math.max(0, (server.eventLoopUtilization ?? 0) - weights.eluBudget);
  return (
    server.players +
    server.instances * weights.instanceWeight +
    tickOver * weights.tickPenaltyPerMs +
    eluOver * 100 * weights.eluPenaltyPerPercent
  );
}

/** Servers that may receive new players at all. */
export function canPlaceOn(server: ServerCandidate, excludeServerId?: string): boolean {
  return (
    server.state === "ready" &&
    server.players < server.capacity &&
    server.serverId !== excludeServerId
  );
}

/** The best server for a new instance, or undefined if the fleet is full. */
export function chooseServer(
  servers: ServerCandidate[],
  options: { excludeServerId?: string; weights?: PlacementWeights } = {},
): ServerCandidate | undefined {
  let best: ServerCandidate | undefined;
  let bestScore = Infinity;
  for (const server of servers) {
    if (!canPlaceOn(server, options.excludeServerId)) continue;
    const score = serverScore(server, options.weights);
    if (score < bestScore || (score === bestScore && server.serverId < best!.serverId)) {
      best = server;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The region a new instance of this zone is created in:
 * - public zones (hubs, overworld): the player's home region;
 * - party_private: the party leader's region (D9), else the player's;
 * - portal_bound: the region of the instance holding the portal.
 * Existing keyed instances (a party's dungeon, a portal's instance) are
 * joined wherever they run; see `joinsAcrossRegions`.
 */
export function targetRegion(
  zone: ZoneDefinition,
  request: PlacementRequest & {
    /** The player's home region. */
    region: string;
    /** The party leader's home region, if in a party. */
    leaderRegion?: string;
  },
  regionOfInstance: (instanceId: string) => string | undefined,
): string {
  switch (zone.access.kind) {
    case "public_sharded":
      return request.region;
    case "party_private":
      return request.leaderRegion ?? request.region;
    case "portal_bound":
      return (request.via && regionOfInstance(request.via.sourceInstanceId)) ?? request.region;
  }
}

/** Whether an existing instance may be joined outside the target region. */
export function joinsAcrossRegions(zone: ZoneDefinition): boolean {
  return zone.access.kind !== "public_sharded";
}

/** The key an instance must have to be joined, for keyed access policies. */
export function ownerKeyFor(
  zone: ZoneDefinition,
  request: PlacementRequest,
): { ownerPartyId?: string; boundPortalKey?: string } {
  switch (zone.access.kind) {
    case "public_sharded":
      return {};
    case "party_private":
      return { ownerPartyId: request.partyId ?? soloPartyId(request.characterId) };
    case "portal_bound":
      if (!request.via) {
        throw new PlacementError(400, `Zone ${zone.id} can only be entered through a portal`);
      }
      return { boundPortalKey: portalKey(request.via.sourceInstanceId, request.via.portalId) };
  }
}

/**
 * The existing instance a character should join (only instances on servers
 * that accept players are passed in), or undefined to create a new one.
 */
export function findInstance(
  zone: ZoneDefinition,
  request: PlacementRequest,
  instances: InstanceCandidate[],
): InstanceCandidate | undefined {
  const inZone = instances.filter((i) => i.zoneId === zone.id);
  const access = zone.access;
  if (access.kind === "public_sharded") {
    if (request.preferInstanceId) {
      const preferred = inZone.find((i) => i.id === request.preferInstanceId);
      if (preferred && preferred.players < access.hardCap) return preferred;
    }
    // Fill first: the fullest shard that is still below the soft cap.
    let fullest: InstanceCandidate | undefined;
    for (const instance of inZone) {
      if (instance.players >= access.softCap) continue;
      if (!fullest || instance.players > fullest.players) fullest = instance;
    }
    return fullest;
  }
  const key = ownerKeyFor(zone, request);
  return inZone.find(
    (i) =>
      (key.ownerPartyId === undefined || i.ownerPartyId === key.ownerPartyId) &&
      (key.boundPortalKey === undefined || i.boundPortalKey === key.boundPortalKey),
  );
}

export class PlacementError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Machine-readable cause, sent to the caller (e.g. "region_unavailable"). */
    public readonly reason?: string,
  ) {
    super(message);
  }
}
