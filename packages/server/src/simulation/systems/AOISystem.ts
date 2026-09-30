import { query, hasComponent } from "bitecs";
import {
  Position,
  Velocity,
  Identity,
  Model,
  Health,
  CombatStats,
  Progression,
  Equipment,
  Inventory,
  InputQueue,
  LootBag,
  Portal,
  Player,
  Enemy,
  PortalTag,
  LootBagTag,
  getXpForNextLevel,
  type EntityState,
} from "@rotmg/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";

export class AOISystem implements ISystem {
  public readonly name = "AOISystem";
  public static readonly AOI_RADIUS = 25;

  public update(world: GameWorld, _dt: number, now: number): void {
    const ecs = world.ecsWorld;
    const lastAckSeqs: Record<string, number> = {};
    const playerSnapshots: Record<string, EntityState[]> = {};
    const entityCache = new Map<number, EntityState>();

    const getEntityState = (eid: number): EntityState | null => {
      let state = entityCache.get(eid);
      if (state !== undefined) return state;

      if (hasComponent(ecs, eid, Player)) {
        const isAlive = Health.current[eid] > 0;
        state = {
          id: Identity.uuid[eid],
          type: "player",
          subtype: Progression.classId[eid],
          x: Position.x[eid],
          y: Position.y[eid],
          vx: Velocity.vx[eid] || 0,
          vy: Velocity.vy[eid] || 0,
          angle: Position.angle[eid] || 0,
          hp: Math.max(0, Health.current[eid]),
          maxHp: Health.max[eid],
          name: Identity.name[eid],
          level: Progression.level[eid],
          defense: CombatStats.defense[eid] || 0,
          classId: Progression.classId[eid],
          equipment: {
            weapon: Equipment.weapon[eid] ?? null,
            armor: Equipment.armor[eid] ?? null,
          },
          inventory: [...(Inventory.slots[eid] || new Array(8).fill(null))],
          xp: Progression.xp[eid] || 0,
          nextLevelXp: getXpForNextLevel(Progression.level[eid]),
          isAlive,
          modelId: Model.modelId[eid] || Identity.prefabId[eid] || "player",
        };
      } else if (hasComponent(ecs, eid, Enemy)) {
        if (Health.current[eid] <= 0) return null;
        state = {
          id: Identity.uuid[eid],
          type: "monster",
          subtype: Identity.prefabId[eid] || Model.modelId[eid],
          x: Position.x[eid],
          y: Position.y[eid],
          vx: Velocity.vx[eid] || 0,
          vy: Velocity.vy[eid] || 0,
          angle: Position.angle[eid] || 0,
          hp: Math.max(0, Health.current[eid]),
          maxHp: Health.max[eid],
          name: Identity.name[eid],
          level: Progression.level?.[eid] || 1,
          isAlive: true,
          modelId: Model.modelId[eid] || Identity.prefabId[eid],
          defense: CombatStats.defense[eid] || 0,
        };
      } else if (hasComponent(ecs, eid, PortalTag)) {
        state = {
          id: Identity.uuid[eid],
          type: "portal",
          subtype: Portal.kind[eid],
          x: Position.x[eid],
          y: Position.y[eid],
          vx: 0,
          vy: 0,
          angle: 0,
          hp: 1,
          maxHp: 1,
          name: Portal.name[eid],
          level: 0,
          isAlive: true,
          modelId: Model.modelId[eid] || "portal_nexus",
        };
      } else if (hasComponent(ecs, eid, LootBagTag)) {
        state = {
          id: Identity.uuid[eid],
          type: "loot_bag",
          subtype: LootBag.kind[eid],
          x: Position.x[eid],
          y: Position.y[eid],
          vx: 0,
          vy: 0,
          angle: 0,
          hp: 1,
          maxHp: 1,
          name: "Loot Bag",
          level: 0,
          isAlive: true,
          modelId: Model.modelId[eid] || LootBag.kind[eid],
          itemIds: [...(LootBag.itemIds[eid] || [])],
        };
      }

      if (state) {
        entityCache.set(eid, state);
      }
      return state ?? null;
    };

    // 1. Players query
    const players = query(ecs, [
      Player,
      Position,
      Identity,
      Health,
      Progression,
      Equipment,
      Inventory,
    ]);

    for (const pEid of players) {
      const uuid = Identity.uuid[pEid];
      lastAckSeqs[uuid] = InputQueue.lastAckSeq[pEid] || 0;
      getEntityState(pEid);
    }

    // 2. Build spatial AOI per player
    for (const pEid of players) {
      const uuid = Identity.uuid[pEid];
      const pPos = { x: Position.x[pEid], y: Position.y[pEid] };
      const nearbyEids = world.spatial.queryRadius(
        world,
        pPos,
        AOISystem.AOI_RADIUS,
      );

      const playerEntities: EntityState[] = [];
      const included = new Set<string>();

      // Always include self
      const selfState = getEntityState(pEid);
      if (selfState) {
        playerEntities.push(selfState);
        included.add(uuid);
      }

      for (const eid of nearbyEids) {
        const entState = getEntityState(eid);
        if (entState && !included.has(entState.id)) {
          playerEntities.push(entState);
          included.add(entState.id);
        }
      }

      playerSnapshots[uuid] = playerEntities;
    }

    // If no players are present, also populate all enemies/portals/bags for headless tests or empty world
    if (players.length === 0) {
      const enemies = query(ecs, [Enemy, Position, Identity, Health]);
      for (const mEid of enemies) {
        getEntityState(mEid);
      }
      const portals = query(ecs, [PortalTag, Position, Identity, Portal]);
      for (const portEid of portals) {
        getEntityState(portEid);
      }
      const bags = query(ecs, [LootBagTag, Position, Identity, LootBag]);
      for (const bEid of bags) {
        getEntityState(bEid);
      }
    }

    const allEntities = Array.from(entityCache.values());

    world.recordSnapshot({
      worldId: world.worldId,
      tick: world.currentTick,
      serverTime: now,
      lastAckSeqs,
      entities: allEntities,
      playerSnapshots,
    });
  }
}
