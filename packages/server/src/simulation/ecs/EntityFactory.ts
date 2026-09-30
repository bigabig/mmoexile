import { addEntity, addComponent, hasComponent, type World } from "bitecs";
import { randomUUID } from "crypto";
import {
  COMPONENT_REGISTRY,
  Identity,
  SpawnedBy,
  getPrefab,
  getClassDefinition,
  computeBaseStatsForLevel,
  computeEffectiveStats,
  type EntityPrefab,
  type ComponentValueMap,
  type PlayerEquipment,
  type ProjectileShape,
} from "@rotmg/shared";

export interface SpawnPlayerOptions {
  id: string;
  name: string;
  classId: string;
  level?: number;
  xp?: number;
  hp?: number;
  mp?: number;
  x: number;
  y: number;
  angle?: number;
  equipment?: Partial<PlayerEquipment>;
  inventory?: (string | null)[];
}

export interface SpawnProjectileOptions {
  id?: string;
  ownerEid: number;
  isPlayer: boolean;
  startX: number;
  startY: number;
  angle: number;
  speed: number;
  lifetime: number;
  damage: number;
  color?: string;
  radius?: number;
  piercing?: boolean;
  spawnTime?: number;
  prefabId: string;
  shape?: ProjectileShape;
}

export interface SpawnPortalOptions {
  id: string;
  targetWorldId: string;
  name: string;
  kind: string;
  prefabId?: string;
  x: number;
  y: number;
}

export interface SpawnSpawnerOptions {
  id: string;
  x: number;
  y: number;
  prefabId: string;
  count: number;
  respawnSec: number;
  spawnRadius?: number;
}

/**
 * Universal bitECS Prefab Instantiator.
 * Directly maps 1:1 component values from the prefab recipe onto bitECS SoA arrays.
 */
export function instantiatePrefab(
  world: World,
  prefab: EntityPrefab,
  overrides?: ComponentValueMap,
): number {
  const eid = addEntity(world);

  // Attach Tags
  if (prefab.tags) {
    for (const tag of prefab.tags) {
      addComponent(world, eid, tag);
    }
  }

  // Merge prefab components with runtime overrides
  const allCompNames = new Set([
    ...Object.keys(prefab.components),
    ...(overrides ? Object.keys(overrides) : []),
  ]);

  for (const compName of allCompNames) {
    const bitEcsComp = (COMPONENT_REGISTRY as Record<string, any>)[compName];
    if (!bitEcsComp) continue;

    addComponent(world, eid, bitEcsComp);

    const prefabVals = (prefab.components as any)[compName] || {};
    const overrideVals = overrides ? (overrides as any)[compName] || {} : {};
    const mergedProps = { ...prefabVals, ...overrideVals };

    for (const [prop, val] of Object.entries(mergedProps)) {
      if (val !== undefined && prop in bitEcsComp) {
        bitEcsComp[prop][eid] =
          typeof val === "object" && val !== null
            ? Array.isArray(val)
              ? [...val]
              : { ...val }
            : val;
      }
    }
  }

  if (hasComponent(world, eid, Identity)) {
    if (!Identity.uuid[eid]) {
      Identity.uuid[eid] = randomUUID();
    }
  }

  return eid;
}

export class EntityFactory {
  public static instantiate(
    world: World,
    prefab: EntityPrefab,
    overrides?: ComponentValueMap,
  ): number {
    return instantiatePrefab(world, prefab, overrides);
  }

  public static spawnPlayer(world: World, options: SpawnPlayerOptions): number {
    const classId = options.classId;
    const classDef = getClassDefinition(classId);
    const level = options.level ?? 1;
    const xp = options.xp ?? 0;

    const baseStats = computeBaseStatsForLevel(classId, level);
    const equipment: PlayerEquipment = {
      weapon:
        options.equipment?.weapon !== undefined
          ? options.equipment.weapon
          : (classDef.components.Equipment?.weapon ?? null),
      armor:
        options.equipment?.armor !== undefined
          ? options.equipment.armor
          : (classDef.components.Equipment?.armor ?? null),
    };
    const effective = computeEffectiveStats(baseStats, equipment);

    return instantiatePrefab(world, classDef, {
      Position: { x: options.x, y: options.y, angle: options.angle ?? 0 },
      Velocity: { vx: 0, vy: 0 },
      Speed: { value: effective.speed },
      Identity: { uuid: options.id, name: options.name },
      Health: { current: options.hp ?? effective.maxHp, max: effective.maxHp },
      CombatStats: {
        defense: effective.defense,
        attack: effective.attack,
        dexterity: effective.dexterity,
        speed: effective.speed,
      },
      Progression: { level, xp, classId },
      Equipment: { weapon: equipment.weapon, armor: equipment.armor },
      Inventory: {
        slots:
          options.inventory && options.inventory.length === 8
            ? [...options.inventory]
            : new Array(8).fill(null),
      },
      InputQueue: {
        inputs: [],
        lastAckSeq: 0,
      },
      Shooter: {
        cooldownTimer: 0,
      },
    });
  }

  public static spawnMonster(
    world: World,
    subtype: string,
    x: number,
    y: number,
    spawnerEid?: number | null,
    customId?: string,
  ): number {
    const prefab = getPrefab(subtype);
    if (!prefab) {
      throw new Error(`Unknown monster prefab subtype: ${subtype}`);
    }

    const eid = instantiatePrefab(world, prefab, {
      Position: { x, y, angle: 0 },
      Velocity: { vx: 0, vy: 0 },
      Identity: { uuid: customId ?? randomUUID() },
      AI: {
        originX: x,
        originY: y,
        wanderTimer: 0,
        wanderDir: { x: 0, y: 0 },
        currentPhaseIndex: 0,
        attackTimers:
          prefab.components.AI?.phases?.[0]?.attacks?.map(() => 0) ?? [],
      },
    });

    if (spawnerEid !== undefined && spawnerEid !== null) {
      addComponent(world, eid, SpawnedBy(spawnerEid));
    }

    return eid;
  }

  public static spawnProjectile(
    world: World,
    options: SpawnProjectileOptions,
  ): number {
    const prefabId = options.prefabId;
    const prefab = getPrefab(prefabId);
    if (!prefab) {
      throw new Error(`Unknown projectile prefab: ${prefabId}`);
    }

    return instantiatePrefab(world, prefab, {
      Position: { x: options.startX, y: options.startY, angle: options.angle },
      Velocity: {
        vx: Math.cos(options.angle) * options.speed,
        vy: Math.sin(options.angle) * options.speed,
      },
      Collider: {
        radius: options.radius ?? 0.3,
        layer: "projectile",
        isTrigger: true,
      },
      Identity: {
        uuid: options.id ?? randomUUID(),
        name: "Projectile",
        prefabId,
      },
      Model: {
        modelId: prefabId,
        tint: options.color,
      },
      Projectile: {
        speed: options.speed,
        lifetime: options.lifetime,
        spawnTime: options.spawnTime ?? Date.now(),
        damage: options.damage,
        startX: options.startX,
        startY: options.startY,
        color: options.color ?? "#38bdf8",
        shape:
          options.shape ??
          (prefabId === "projectile_rectangular" ? "rectangular" : "square"),
        piercing: options.piercing ?? false,
        isPlayer: options.isPlayer,
        ownerEid: options.ownerEid,
        prefabId,
      },
    });
  }

  public static spawnLootBag(
    world: World,
    x: number,
    y: number,
    itemIds: string[],
    bagKind: "bag_brown" | "bag_cyan" = "bag_brown",
    customId?: string,
  ): number {
    const prefab = getPrefab(bagKind);
    if (!prefab) {
      throw new Error(`Unknown loot bag prefab: ${bagKind}`);
    }

    return instantiatePrefab(world, prefab, {
      Position: { x, y, angle: 0 },
      Identity: { uuid: customId ?? randomUUID() },
      LootBag: {
        itemIds: [...itemIds],
        kind: bagKind,
        createdAt: Date.now(),
        maxLifetimeMs: 60000,
      },
    });
  }

  public static spawnPortal(world: World, options: SpawnPortalOptions): number {
    const prefabId =
      options.prefabId ??
      (options.kind === "nexus"
        ? "portal_nexus"
        : options.kind === "dungeon"
          ? "portal_dungeon"
          : options.kind === "realm"
            ? "portal_realm"
            : options.kind);
    const prefab = getPrefab(prefabId);
    if (!prefab) {
      throw new Error(`Unknown portal prefab: ${prefabId}`);
    }

    return instantiatePrefab(world, prefab, {
      Position: { x: options.x, y: options.y, angle: 0 },
      Identity: { uuid: options.id, name: options.name },
      Portal: {
        targetWorldId: options.targetWorldId,
        name: options.name,
        kind: options.kind,
      },
    });
  }

  public static spawnSpawner(
    world: World,
    options: SpawnSpawnerOptions,
  ): number {
    const prefab = getPrefab("spawner");
    if (!prefab) {
      throw new Error("Missing spawner prefab");
    }

    return instantiatePrefab(world, prefab, {
      Position: { x: options.x, y: options.y, angle: 0 },
      Identity: {
        uuid: options.id,
        name: `Spawner_${options.prefabId}`,
        prefabId: "spawner",
      },
      Spawner: {
        spawnPrefabId: options.prefabId,
        maxCount: options.count,
        interval: options.respawnSec,
        timer: 0,
        spawnRadius: options.spawnRadius ?? 3.0,
      },
    });
  }
}
