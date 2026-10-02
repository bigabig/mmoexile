import { ZONES, type ZoneId } from "@mmoexile/game-core";
import type { Instance, InstanceId } from "./Instance.js";

export interface PlacementRequest {
  zoneId: ZoneId;
  characterId: string;
  /** The character's party; solo players are treated as a party of one. */
  partyId?: string;
  /** Portal used to get here, for portal_bound zones. */
  via?: { sourceInstanceId: InstanceId; portalId: string };
  /** Join a specific public instance if it has room (e.g. a friend's town). */
  preferInstanceId?: InstanceId;
}

export interface CreateInstanceOptions {
  ownerPartyId?: string;
  boundPortalKey?: string;
}

/** The parts of the instance host that placement needs. */
export interface InstancePool {
  getInstancesForZone(zoneId: ZoneId): Instance[];
  createInstance(zoneId: ZoneId, options?: CreateInstanceOptions): Instance;
}

/**
 * Decides which instance a character enters, according to the zone's access
 * policy. The in-process precursor of the orchestrator's allocation logic.
 */
export interface InstanceDirectory {
  resolve(request: PlacementRequest): Instance;
}

export function soloPartyId(characterId: string): string {
  return `solo:${characterId}`;
}

export function portalKey(sourceInstanceId: InstanceId, portalId: string) {
  return `${sourceInstanceId}/${portalId}`;
}

export class InstanceManager implements InstanceDirectory {
  constructor(private readonly pool: InstancePool) {}

  public resolve(request: PlacementRequest): Instance {
    const zone = ZONES[request.zoneId];
    switch (zone.access.kind) {
      case "public_sharded":
        return this.resolvePublic(request, zone.access);
      case "party_private":
        return this.resolvePartyPrivate(request);
      case "portal_bound":
        return this.resolvePortalBound(request);
    }
  }

  /**
   * Public zones: honor a preferred instance below the hard cap, otherwise
   * fill the most populated instance still below the soft cap, otherwise
   * open a new shard.
   */
  private resolvePublic(
    request: PlacementRequest,
    caps: { softCap: number; hardCap: number },
  ): Instance {
    const open = this.openInstances(request.zoneId);

    if (request.preferInstanceId) {
      const preferred = open.find((i) => i.id === request.preferInstanceId);
      if (preferred && preferred.players.size < caps.hardCap) {
        return preferred;
      }
    }

    const withRoom = open.filter((i) => i.players.size < caps.softCap);
    if (withRoom.length > 0) {
      return withRoom.reduce((fullest, i) =>
        i.players.size > fullest.players.size ? i : fullest,
      );
    }

    return this.pool.createInstance(request.zoneId);
  }

  /** One instance per (zone, party); solo players get their own. */
  private resolvePartyPrivate(request: PlacementRequest): Instance {
    const ownerPartyId =
      request.partyId ?? soloPartyId(request.characterId);
    const existing = this.openInstances(request.zoneId).find(
      (i) => i.ownerPartyId === ownerPartyId,
    );
    return existing ?? this.pool.createInstance(request.zoneId, { ownerPartyId });
  }

  /** One instance per portal; everyone entering through it shares it. */
  private resolvePortalBound(request: PlacementRequest): Instance {
    if (!request.via) {
      throw new Error(
        `Zone ${request.zoneId} is portal_bound and can only be entered through a portal`,
      );
    }
    const boundPortalKey = portalKey(
      request.via.sourceInstanceId,
      request.via.portalId,
    );
    const existing = this.openInstances(request.zoneId).find(
      (i) => i.boundPortalKey === boundPortalKey,
    );
    return (
      existing ?? this.pool.createInstance(request.zoneId, { boundPortalKey })
    );
  }

  private openInstances(zoneId: ZoneId): Instance[] {
    return this.pool
      .getInstancesForZone(zoneId)
      .filter((i) => i.state !== "closed");
  }
}
