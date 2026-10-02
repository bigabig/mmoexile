import {
  createNexusMap,
  createOverworldMap,
  createGolemDungeonMap,
} from "../maps/index.js";
import type { ZoneDefinition, ZoneId } from "./types.js";

export * from "./types.js";

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  nexus: {
    id: "nexus",
    name: "Nexus",
    access: { kind: "public_sharded", softCap: 40, hardCap: 60 },
    emptyTimeoutSec: 60,
    minWarmInstances: 1,
    createMap: createNexusMap,
  },
  overworld: {
    id: "overworld",
    name: "Realm of the Ancients",
    access: { kind: "public_sharded", softCap: 60, hardCap: 85 },
    emptyTimeoutSec: 300,
    createMap: createOverworldMap,
  },
  golem_dungeon: {
    id: "golem_dungeon",
    name: "Golem Lair",
    access: { kind: "party_private" },
    emptyTimeoutSec: 480,
    createMap: createGolemDungeonMap,
  },
};

export function isZoneId(id: string): id is ZoneId {
  return Object.prototype.hasOwnProperty.call(ZONES, id);
}

export function getZone(id: string): ZoneDefinition | undefined {
  return isZoneId(id) ? ZONES[id] : undefined;
}
