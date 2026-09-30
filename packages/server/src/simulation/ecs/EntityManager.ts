import { removeEntity } from "bitecs";
import {
  Position,
  Identity,
  Projectile,
  type ProjectileState,
  type ProjectileShape,
} from "@mmoexile/shared";
import {
  EntityFactory,
  type SpawnPlayerOptions,
  type SpawnProjectileOptions,
  type SpawnPortalOptions,
  type SpawnSpawnerOptions,
} from "./EntityFactory.js";
import type { GameWorld } from "../GameWorld.js";

export class EntityManager {
  constructor(private readonly world: GameWorld) {}

  public getEid(uuid: string): number | undefined {
    return this.world.uuidToEid.get(uuid);
  }

  public getUuid(eid: number): string | undefined {
    return Identity.uuid[eid];
  }

  public hasEntity(uuid: string): boolean {
    return this.world.uuidToEid.has(uuid);
  }

  public spawnPlayer(options: SpawnPlayerOptions): number {
    const eid = EntityFactory.spawnPlayer(this.world.ecsWorld, options);
    this.world.uuidToEid.set(options.id, eid);
    this.world.spatial.insert(eid, options.x, options.y);
    return eid;
  }

  public spawnMonster(
    subtype: string,
    x: number,
    y: number,
    spawnerEid?: number | null,
    customId?: string,
  ): number {
    const eid = EntityFactory.spawnMonster(
      this.world.ecsWorld,
      subtype,
      x,
      y,
      spawnerEid,
      customId,
    );
    const uuid = Identity.uuid[eid];
    if (uuid) {
      this.world.uuidToEid.set(uuid, eid);
    }
    this.world.spatial.insert(eid, x, y);
    return eid;
  }

  public spawnProjectile(options: SpawnProjectileOptions): number {
    const eid = EntityFactory.spawnProjectile(this.world.ecsWorld, options);
    const uuid = Identity.uuid[eid];
    if (uuid) {
      this.world.uuidToEid.set(uuid, eid);
    }

    // Resolve owner UUID from ownerEid if available
    const ownerUuid =
      Identity.uuid[options.ownerEid] ?? String(options.ownerEid);

    const projectileState: ProjectileState = {
      id: uuid,
      ownerId: ownerUuid,
      isPlayer: options.isPlayer,
      startX: options.startX,
      startY: options.startY,
      angle: options.angle,
      speed: options.speed,
      lifetime: options.lifetime,
      damage: options.damage,
      spawnTime: options.spawnTime ?? Date.now(),
      color: options.color ?? "#38bdf8",
      radius: options.radius ?? 0.3,
      piercing: options.piercing ?? false,
      prefabId: options.prefabId,
      shape:
        options.shape ??
        (options.prefabId === "projectile_rectangular"
          ? "rectangular"
          : "square"),
    };

    // Buffer the projectile into tickBuffer and emit event
    this.world.recordSpawnedProjectile(projectileState);

    return eid;
  }

  public spawnLootBag(
    x: number,
    y: number,
    itemIds: string[],
    bagKind: "bag_brown" | "bag_cyan" = "bag_brown",
    customId?: string,
  ): number {
    const eid = EntityFactory.spawnLootBag(
      this.world.ecsWorld,
      x,
      y,
      itemIds,
      bagKind,
      customId,
    );
    const uuid = Identity.uuid[eid];
    if (uuid) {
      this.world.uuidToEid.set(uuid, eid);
    }
    this.world.spatial.insert(eid, x, y);
    return eid;
  }

  public spawnPortal(options: SpawnPortalOptions): number {
    const eid = EntityFactory.spawnPortal(this.world.ecsWorld, options);
    this.world.uuidToEid.set(options.id, eid);
    this.world.spatial.insert(eid, options.x, options.y);
    return eid;
  }

  public spawnSpawner(options: SpawnSpawnerOptions): number {
    const eid = EntityFactory.spawnSpawner(this.world.ecsWorld, options);
    this.world.uuidToEid.set(options.id, eid);
    return eid;
  }

  public destroyEntity(eid: number): void {
    const uuid = Identity.uuid[eid];
    if (uuid) {
      this.world.uuidToEid.delete(uuid);
    }
    this.world.spatial.remove(eid);
    removeEntity(this.world.ecsWorld, eid);
  }

  public destroyEntityByUuid(uuid: string): number | undefined {
    const eid = this.world.uuidToEid.get(uuid);
    if (eid !== undefined) {
      this.destroyEntity(eid);
    }
    return eid;
  }
}

