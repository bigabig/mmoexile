import { randomBytes, randomUUID } from "node:crypto";
import { getZone, type ZoneDefinition } from "@mmoexile/game-core";
import {
  createHttpClient,
  instanceServerApi,
  type AllocateRequest,
  type AllocateResponse,
} from "@mmoexile/contracts";
import type { Logger } from "@mmoexile/service-kit";
import type { InstanceEntry, Registry, ServerEntry } from "./Registry.js";
import {
  chooseServer,
  findInstance,
  joinsAcrossRegions,
  ownerKeyFor,
  PlacementError,
  targetRegion,
  type PlacementWeights,
  type ServerCandidate,
} from "./placement.js";

/** Signs a transfer ticket; the orchestrator is the only issuer. */
export type TicketSigner = (claims: {
  ticketId: string;
  characterId: string;
  accountId: string;
  zoneId: string;
  instanceId: string;
  targetServerId: string;
  /** The player's home region (not necessarily the server's). */
  region: string;
  partyId?: string;
  via?: { sourceInstanceId: string; portalId: string };
}) => Promise<string>;

export interface AllocatorDeps {
  registry: Registry;
  signTicket: TicketSigner;
  logger: Logger;
  weights?: PlacementWeights;
  fetch?: typeof fetch;
  /**
   * Resolves once the registry is worth asking (after a restart, the fleet
   * reports within one heartbeat interval).
   */
  warmup?: () => Promise<void>;
  /** Called with the duration of every allocation (metrics). */
  onAllocated?: (durationMs: number, created: boolean) => void;
}

/**
 * Answers "where does this character go?" for the whole fleet: joins an
 * existing instance when the zone's access policy allows it, otherwise
 * creates one on the best server, then issues a ticket for exactly that
 * server and instance.
 */
export class Allocator {
  /** One placement decision per zone+owner at a time (no duplicate instances). */
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: AllocatorDeps) {}

  async allocate(request: AllocateRequest): Promise<AllocateResponse> {
    const started = performance.now();
    await this.deps.warmup?.();
    const zone = getZone(request.zoneId);
    if (!zone) throw new PlacementError(400, `Unknown zone ${request.zoneId}`);

    const { instance, created } = await this.withLock(lockKey(zone, request), async () => {
      const placed = await this.place(zone, request);
      // Count the player before the next decision for this zone is made.
      this.deps.registry.reserve(placed.instance);
      return placed;
    });
    const server = this.deps.registry.get(instance.serverId)!;

    const ticketId = randomUUID();
    const ticket = await this.deps.signTicket({
      ticketId,
      characterId: request.characterId,
      accountId: request.accountId,
      zoneId: zone.id,
      instanceId: instance.id,
      targetServerId: server.serverId,
      region: request.region,
      partyId: request.partyId,
      via: request.via,
    });
    this.deps.onAllocated?.(performance.now() - started, created);
    this.deps.logger.info(
      {
        ticketId,
        characterId: request.characterId,
        zoneId: zone.id,
        instanceId: instance.id,
        serverId: server.serverId,
        homeRegion: request.region,
        serverRegion: server.region,
        created,
      },
      "Allocated",
    );
    return {
      serverId: server.serverId,
      instanceId: instance.id,
      url: server.url,
      ticket,
      ticketId,
    };
  }

  private async place(
    zone: ZoneDefinition,
    request: AllocateRequest,
  ): Promise<{ instance: InstanceEntry; created: boolean }> {
    const registry = this.deps.registry;
    const region = targetRegion(zone, request, (instanceId) => {
      const instance = registry.instances().find((i) => i.id === instanceId);
      return instance && registry.get(instance.serverId)?.region;
    });
    const open = registry
      .all()
      .filter((s) => registry.acceptsPlayers(s) && s.serverId !== request.excludeServerId);
    // Public shards only in the target region; a party's dungeon or a
    // portal's instance wherever it already runs.
    const joinable = joinsAcrossRegions(zone) ? open : open.filter((s) => s.region === region);
    const existing = findInstance(
      zone,
      request,
      joinable.flatMap((s) =>
        [...s.instances.values()]
          .filter((i) => i.state !== "closed" && i.state !== "crashed")
          .map((i) => ({ ...i, players: registry.load(i) })),
      ),
    );
    if (existing) {
      return { instance: registry.get(existing.serverId)!.instances.get(existing.id)!, created: false };
    }

    // Create a new instance. A server that fails to create one is skipped.
    const skipped = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const server = chooseServer(
        this.candidates(region).filter((c) => !skipped.has(c.serverId)),
        { excludeServerId: request.excludeServerId, weights: this.deps.weights },
      );
      if (!server) break;
      const entry = registry.get(server.serverId)!;
      try {
        return { instance: await this.createOn(entry, zone, request), created: true };
      } catch (err) {
        skipped.add(server.serverId);
        this.deps.logger.warn({ err, serverId: server.serverId }, "Instance creation failed, trying another server");
      }
    }
    // No spill-over into another region: the player decides (S4.5).
    throw new PlacementError(
      503,
      `No instance server in region ${region} can take more players right now`,
      "region_unavailable",
    );
  }

  private async createOn(
    server: ServerEntry,
    zone: ZoneDefinition,
    request: AllocateRequest,
  ): Promise<InstanceEntry> {
    const owner = ownerKeyFor(zone, request);
    let instanceId = newInstanceId(zone.id);
    while (this.deps.registry.instances().some((i) => i.id === instanceId)) {
      instanceId = newInstanceId(zone.id);
    }
    const call = createHttpClient({ baseUrl: server.internalUrl, fetch: this.deps.fetch });
    await call(instanceServerApi.createInstance, { instanceId, zoneId: zone.id, ...owner });
    return this.deps.registry.addInstance(server.serverId, {
      id: instanceId,
      zoneId: zone.id,
      ...owner,
      players: 0,
      state: "empty",
    });
  }

  /** Servers of one region, as placement candidates. */
  private candidates(region: string): ServerCandidate[] {
    const registry = this.deps.registry;
    return registry.all().filter((s) => s.region === region).map((s) => ({
      serverId: s.serverId,
      // A server that went quiet is treated like one that isn't ready.
      state: registry.acceptsPlayers(s) ? s.state : "starting",
      capacity: s.capacity,
      players: registry.serverPlayers(s),
      instances: s.instances.size,
      tickP95Ms: s.tickP95Ms,
      eventLoopUtilization: s.eventLoopUtilization,
    }));
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.catch(() => {});
    this.locks.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    }
  }
}

function lockKey(zone: ZoneDefinition, request: AllocateRequest): string {
  const owner = ownerKeyFor(zone, request);
  return `${zone.id}|${owner.ownerPartyId ?? owner.boundPortalKey ?? "public"}`;
}

function newInstanceId(zoneId: string): string {
  return `${zoneId}:${randomBytes(3).toString("hex")}`;
}
