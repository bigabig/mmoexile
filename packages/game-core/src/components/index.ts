import { createRelation, makeExclusive } from "bitecs";

// ============================================================================
// 1. Generic ECS Component Value Helper
// ============================================================================
export type ComponentValue<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U : T[K];
};

// ============================================================================
// 2. Component Column Sub-Types (Data Models stored in bitECS Arrays)
// ============================================================================

// Animation & Visuals
export type ProceduralAnimationType =
  | "none"
  | "squash_and_stretch"
  | "float"
  | "bob"
  | "spin";

// Physics & Projectiles
export type CollisionLayer =
  | "player"
  | "enemy"
  | "projectile"
  | "item"
  | "portal"
  | "neutral";

export type ProjectileShape = "square" | "rectangular";

// AI & Behaviors
export type AIBehavior = "idle" | "chase" | "patrol" | "flee" | "leash";
export type AIState = "idle" | "chasing" | "attacking" | "returning";
export type AttackType = "single_shot" | "shotgun" | "radial_nova";

export interface MonsterAttackConfig {
  type?: AttackType | string;
  cooldown?: number;
  shootCooldown?: number;
  bulletCount?: number;
  spreadCount?: number;
  spreadAngle?: number;
  damage?: number;
  speed?: number;
  lifetime?: number;
  range?: number;
  color?: string;
  radius?: number;
  bulletPrefab?: string;
  projectilePrefabId?: string;
}

export interface PhaseMovementConfig {
  type: "chase" | "stand" | "patrol" | "flee" | "leash" | string;
  aggroRadius?: number;
  moveSpeed?: number;
  standoffDistance?: number;
  leashRadius?: number;
  trackPlayer?: boolean;
}

export interface AIPhaseConfig {
  phaseIndex?: number;
  name?: string;
  healthThreshold?: number;
  triggerOnHpPercent?: number;
  speedMultiplier?: number;
  shootCooldownMultiplier?: number;
  tint?: string;
  movement?: PhaseMovementConfig;
  attacks?: MonsterAttackConfig[];
}

// Drops & Loot
export type LootBagTier = "bag_brown" | "bag_cyan";

export interface DropTableEntry {
  itemId: string;
  chance: number; // 0.0 to 1.0
  minQuantity?: number;
  maxQuantity?: number;
}

// Character Stats & Progression
export interface CharacterBaseStats {
  maxHp: number;
  maxMp: number;
  defense: number;
  speed: number;
  attack: number;
  dexterity: number;
}

export interface EffectivePlayerStats {
  maxHp: number;
  maxMp: number;
  defense: number;
  speed: number;
  attack: number;
  dexterity: number;
}

export interface ClassProgressionConfig {
  baseStats: CharacterBaseStats;
  statGainsPerLevel: CharacterBaseStats;
  allowedWeaponSubtypes: string[];
  allowedArmorSubtypes: string[];
  defaultEquipment: {
    weapon: string;
    armor: string;
  };
}

export interface PlayerInputItem {
  seq: number;
  moveX: number;
  moveY: number;
  angle: number;
  dt: number;
}

// ============================================================================
// 3. bitECS Structure-of-Arrays (SoA) Components
// ============================================================================

// Transform & Spatial Physics
export const Position = {
  x: [] as number[],
  y: [] as number[],
  angle: [] as number[],
};

export const Velocity = {
  vx: [] as number[],
  vy: [] as number[],
};

export const Speed = {
  value: [] as number[],
};

export const Collider = {
  radius: [] as number[],
  layer: [] as CollisionLayer[],
  isTrigger: [] as boolean[],
};

// Identity & Network Sync
export const Identity = {
  uuid: [] as string[],
  name: [] as string[],
  prefabId: [] as string[],
};

// Visual Representation & Rendering
export const Model = {
  modelId: [] as string[],
  scale: [] as number[],
  tint: [] as (string | undefined)[],
  offsetY: [] as (number | undefined)[],
};

export const Animation = {
  type: [] as (ProceduralAnimationType | undefined)[],
  speed: [] as (number | undefined)[],
  amplitude: [] as (number | undefined)[],
  axis: [] as ("x" | "y" | "z" | undefined)[],
};

export const Minimap = {
  color: [] as string[],
  radius: [] as number[],
  shape: [] as ("circle" | "square" | "diamond" | undefined)[],
};

// Health & Combat Stats
export const Health = {
  current: [] as number[],
  max: [] as number[],
};

export const CombatStats = {
  defense: [] as number[],
  attack: [] as number[],
  dexterity: [] as number[],
  speed: [] as number[],
  xpReward: [] as number[],
};

export const Damage = {
  amount: [] as number[],
  sourceEid: [] as number[],
};

export const Shooter = {
  cooldownTimer: [] as number[],
};

// Player Progression, Inventory & Equipment
export const Progression = {
  level: [] as number[],
  xp: [] as number[],
  classId: [] as string[],
  classData: [] as (ClassProgressionConfig | undefined)[],
};

export const Inventory = {
  slots: [] as (string | null)[][], // 8-slot array per entity
};

export const Equipment = {
  weapon: [] as (string | null)[],
  armor: [] as (string | null)[],
};

export type PlayerEquipment = ComponentValue<typeof Equipment>;

export const InputQueue = {
  inputs: [] as PlayerInputItem[][],
  lastAckSeq: [] as number[],
};

// Projectiles
export const Projectile = {
  speed: [] as number[],
  lifetime: [] as number[],
  spawnTime: [] as number[],
  damage: [] as number[],
  startX: [] as number[],
  startY: [] as number[],
  color: [] as string[],
  shape: [] as ProjectileShape[],
  piercing: [] as boolean[],
  isPlayer: [] as boolean[],
  ownerEid: [] as number[],
  prefabId: [] as (string | undefined)[],
};

// Enemies & AI State
export const AI = {
  phases: [] as AIPhaseConfig[][],
  currentPhaseIndex: [] as number[],
  attackTimers: [] as number[][],
  wanderTimer: [] as number[],
  wanderDir: [] as { x: number; y: number }[],
  originX: [] as number[],
  originY: [] as number[],
};

export const DropTable = {
  drops: [] as DropTableEntry[][],
};

// Environment & World Interactive Objects
export const Spawner = {
  spawnPrefabId: [] as string[],
  maxCount: [] as number[],
  interval: [] as number[], // respawn interval in seconds
  timer: [] as number[],
  spawnRadius: [] as number[],
};

export const LootBag = {
  itemIds: [] as string[][],
  kind: [] as LootBagTier[],
  createdAt: [] as number[],
  maxLifetimeMs: [] as number[],
};

export const Portal = {
  targetZoneId: [] as string[],
  name: [] as string[],
  kind: [] as string[],
};

// ============================================================================
// 4. Tag Components (Empty objects for zero-cost bitmask queries)
// ============================================================================
export const Player = {};
export const Enemy = {};
export const ProjectileTag = {};
export const PortalTag = {};
export const LootBagTag = {};
export const SpawnerTag = {};
export const Dead = {};

// ============================================================================
// 5. bitECS Relations
// ============================================================================
export const SpawnedBy = createRelation();
export const Targeting = createRelation(makeExclusive);

// ============================================================================
// 6. Canonical Component Registry (Single Source of Truth)
// ============================================================================
export const COMPONENT_REGISTRY = {
  Position,
  Velocity,
  Speed,
  Collider,
  Identity,
  Model,
  Animation,
  Minimap,
  Health,
  CombatStats,
  Damage,
  Shooter,
  Progression,
  Inventory,
  Equipment,
  InputQueue,
  Projectile,
  AI,
  DropTable,
  Spawner,
  LootBag,
  Portal,
} as const;

export type ComponentRegistry = typeof COMPONENT_REGISTRY;
export type ComponentName = keyof ComponentRegistry;

/**
 * ComponentValueMap is purely inferred from the bitECS components in COMPONENT_REGISTRY.
 * There is zero manual type duplication between ECS and Prefabs.
 */
export type ComponentValueMap = {
  [K in ComponentName]?: ComponentValue<ComponentRegistry[K]>;
};
