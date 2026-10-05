import type { EntityPrefab } from "./types.js";
import { WizardClassPrefab, KnightClassPrefab } from "./characters/index.js";
import { SlimePrefab, PiratePrefab, GolemBossPrefab } from "./enemies/index.js";
import {
  SquareProjectilePrefab,
  RectangularProjectilePrefab,
} from "./projectiles/index.js";
import {
  NexusPortalPrefab,
  RealmPortalPrefab,
  GolemDungeonPortalPrefab,
  BrownLootBagPrefab,
  CyanLootBagPrefab,
  GenericSpawnerPrefab,
} from "./environment/index.js";

/**
 * Universal registry dictionary holding all entity prefabs/blueprints in the game engine.
 */
export const PREFABS: Record<string, EntityPrefab> = {
  // Characters
  wizard: WizardClassPrefab,
  knight: KnightClassPrefab,

  // Monsters
  slime: SlimePrefab,
  pirate: PiratePrefab,
  golem_boss: GolemBossPrefab,

  // Projectiles
  projectile_square: SquareProjectilePrefab,
  projectile_rectangular: RectangularProjectilePrefab,

  // Portals
  portal_nexus: NexusPortalPrefab,
  portal_realm: RealmPortalPrefab,
  portal_dungeon: GolemDungeonPortalPrefab,
  portal_golem_dungeon: GolemDungeonPortalPrefab,
  nexus: NexusPortalPrefab,
  realm: RealmPortalPrefab,
  dungeon: GolemDungeonPortalPrefab,

  // Loot bags
  bag_brown: BrownLootBagPrefab,
  bag_cyan: CyanLootBagPrefab,

  // Spawners
  spawner: GenericSpawnerPrefab,
};

/**
 * Universal prefab getter for all entity types across the engine.
 */
export function getPrefab<T extends EntityPrefab = EntityPrefab>(
  id: string,
): T | undefined {
  return PREFABS[id] as T | undefined;
}
