import { query, hasComponent, addComponent } from "bitecs";
import { randomUUID } from "crypto";
import {
  SpawnerTag,
  Spawner,
  Position,
  Dead,
  SpawnedBy,
  Identity,
  getPrefab,
} from "@rotmg/shared";
import type { ISystem } from "./ISystem.js";
import type { GameWorld } from "../GameWorld.js";
import { instantiatePrefab } from "../ecs/EntityFactory.js";

export class SpawnerSystem implements ISystem {
  public readonly name = "SpawnerSystem";

  private spawnEntityFromSpawner(world: GameWorld, spawnerEid: number): number {
    const targetPrefabId = Spawner.spawnPrefabId[spawnerEid];
    const prefab = getPrefab(targetPrefabId);
    if (!prefab) {
      throw new Error(`Spawner cannot find target prefab: ${targetPrefabId}`);
    }

    const spawnRadius = Spawner.spawnRadius[spawnerEid] || 1.0;
    const spawnX =
      Position.x[spawnerEid] + (Math.random() - 0.5) * spawnRadius * 2;
    const spawnY =
      Position.y[spawnerEid] + (Math.random() - 0.5) * spawnRadius * 2;

    const ecs = world.ecsWorld;
    const childEid = instantiatePrefab(ecs, prefab, {
      Position: { x: spawnX, y: spawnY, angle: 0 },
      Velocity: prefab.components.Velocity ? { vx: 0, vy: 0 } : undefined,
      Identity: { uuid: randomUUID() },
      ...(prefab.components.AI
        ? {
            AI: {
              originX: spawnX,
              originY: spawnY,
              wanderTimer: 0,
              wanderDir: { x: 0, y: 0 },
              currentPhaseIndex: 0,
              attackTimers:
                prefab.components.AI.phases?.[0]?.attacks?.map(() => 0) ?? [],
            },
          }
        : {}),
    });

    addComponent(ecs, childEid, SpawnedBy(spawnerEid));
    const uuid = Identity.uuid[childEid];
    if (uuid) {
      world.uuidToEid.set(uuid, childEid);
    }
    world.spatial.insert(childEid, spawnX, spawnY);
    return childEid;
  }

  public init(world: GameWorld): void {
    const ecs = world.ecsWorld;
    const spawners = query(ecs, [SpawnerTag, Spawner, Position]);

    for (const spawnerEid of spawners) {
      // Spawn initial population
      const maxCount = Spawner.maxCount[spawnerEid];
      for (let i = 0; i < maxCount; i++) {
        this.spawnEntityFromSpawner(world, spawnerEid);
      }
    }
  }

  public update(world: GameWorld, dt: number, _now: number): void {
    const ecs = world.ecsWorld;
    const spawners = query(ecs, [SpawnerTag, Spawner, Position]);

    for (const spawnerEid of spawners) {
      const allChildren = query(ecs, [SpawnedBy(spawnerEid)]);
      const aliveChildren = allChildren.filter(
        (eid) => !hasComponent(ecs, eid, Dead),
      );
      const maxCount = Spawner.maxCount[spawnerEid];

      if (aliveChildren.length < maxCount) {
        Spawner.timer[spawnerEid] += dt;

        if (Spawner.timer[spawnerEid] >= Spawner.interval[spawnerEid]) {
          Spawner.timer[spawnerEid] = 0;
          this.spawnEntityFromSpawner(world, spawnerEid);
        }
      }
    }
  }
}
