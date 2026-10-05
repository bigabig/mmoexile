import type { ComponentValueMap } from "../components/index.js";

export type PrefabCategory =
  | "character"
  | "enemy"
  | "projectile"
  | "portal"
  | "loot_bag"
  | "prop"
  | "spawner";

export interface EntityPrefab {
  id: string;
  name: string;
  category: PrefabCategory;
  tags?: any[];
  components: ComponentValueMap;
}

export type CharacterClassPrefab = EntityPrefab & { category: "character" };
export type MonsterPrefab = EntityPrefab & { category: "enemy" };
export type ProjectilePrefab = EntityPrefab & { category: "projectile" };
export type PortalPrefab = EntityPrefab & { category: "portal" };
export type LootBagPrefab = EntityPrefab & { category: "loot_bag" };
export type SpawnerPrefab = EntityPrefab & { category: "spawner" };
