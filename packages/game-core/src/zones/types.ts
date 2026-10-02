import type { MapData } from "../maps/types.js";

/**
 * A zone is a static template (map layout, spawns, rules). Instances are live,
 * running copies created from a zone. See SERVER_INFRASTRUCTURE.md §1.
 */
export type ZoneId = "nexus" | "overworld" | "golem_dungeon";

/**
 * Who may enter an instance of a zone, and how players are spread across
 * instances.
 */
export type AccessPolicy =
  /** Anyone; players are spread across copies with a player cap (hubs, towns). */
  | { kind: "public_sharded"; softCap: number; hardCap: number }
  /** One instance per party (or per solo player), like PoE maps. */
  | { kind: "party_private" }
  /** One instance per portal; everyone entering that portal shares it (RotMG dungeons). */
  | { kind: "portal_bound" };

export interface ZoneDefinition {
  id: ZoneId;
  /** Display name shown to players. */
  name: string;
  access: AccessPolicy;
  /** How long an instance survives with no players in it. */
  emptyTimeoutSec: number;
  /** Keep at least this many instances alive even when empty (hubs). */
  minWarmInstances?: number;
  createMap: () => MapData;
}
