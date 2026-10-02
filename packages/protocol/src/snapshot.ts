import type { PlayerEquipment } from "@mmoexile/game-core";

export type EntityType = "player" | "monster" | "portal" | "loot_bag";

/**
 * Network replication snapshot state for dynamic entities in the world.
 * Transmitted at 30Hz in S2C_SnapshotPacket and S2C_WelcomePacket.
 */
export interface EntityState {
  id: string;
  type: EntityType;
  subtype: string; // 'player', 'slime', 'pirate', 'golem_boss', 'realm', 'dungeon', 'nexus', 'bag_brown'
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  name: string;
  level: number;
  isAlive: boolean;
  modelId?: string;
  defense?: number;
  classId?: string;
  equipment?: PlayerEquipment;
  inventory?: (string | null)[];
  xp?: number;
  nextLevelXp?: number;
  tier?: string;
  targetZoneId?: string;
  itemIds?: string[];
  portalKind?: string;
}
