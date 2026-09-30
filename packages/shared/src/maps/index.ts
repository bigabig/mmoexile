import { MapData } from "./types.js";
import { createNexusMap } from "./nexus.js";
import { createRealmMap } from "./realmAncients.js";
import { createGolemDungeonMap } from "./golemDungeon.js";

export const STATIC_MAPS: Record<string, () => MapData> = {
  nexus: createNexusMap,
  realm_1: createRealmMap,
  dungeon_golem: createGolemDungeonMap,
};
