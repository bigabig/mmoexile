import { randomBytes } from "crypto";
import type { MapData, ZoneDefinition, ZoneId } from "@mmoexile/game-core";
import type { GameWorld } from "@mmoexile/simulation";
import type { IWorldRunner } from "./runners/IWorldRunner.js";

/**
 * Globally unique, human-readable instance ID: "<zoneId>:<shortId>",
 * e.g. "golem_dungeon:7f3a9c".
 */
export type InstanceId = string;

export type InstanceState = "creating" | "running" | "empty" | "closed";

/**
 * One live, ticking copy of a zone. See SERVER_INFRASTRUCTURE.md §1.
 */
export interface Instance {
  readonly id: InstanceId;
  readonly zone: ZoneDefinition;
  readonly world: GameWorld;
  readonly runner: IWorldRunner;
  readonly mapData: MapData;
  /** Characters currently inside this instance. */
  readonly players: Set<string>;
  /** Party that owns a party_private instance (solo players: "solo:<characterId>"). */
  readonly ownerPartyId?: string;
  /** Portal a portal_bound instance belongs to: "<sourceInstanceId>/<portalId>". */
  readonly boundPortalKey?: string;
  state: InstanceState;
  readonly createdAt: number;
  /** When the last player left; unset while players are inside. */
  emptySince?: number;
}

export function generateInstanceId(zoneId: ZoneId): InstanceId {
  return `${zoneId}:${randomBytes(3).toString("hex")}`;
}
