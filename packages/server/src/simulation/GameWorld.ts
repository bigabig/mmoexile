import {
  createWorld,
  query,
  removeEntity,
  hasComponent,
  type World,
} from "bitecs";
import {
  MapData,
  ProjectileState,
  DamageEvent,
  isSolidTile,
  Position,
  Health,
  Progression,
  Equipment,
  Inventory,
  InputQueue,
  Projectile,
  ProjectileTag,
  Player,
  Identity,
  getPrefab,
  type PlayerInputItem,
} from "@rotmg/shared";
import { EventBus } from "./events/EventBus.js";
import type {
  WorldEventMap,
  LootBagSpawnedEvent,
  LootBagDespawnedEvent,
  SnapshotEvent,
  PlayerPersistenceSnapshot,
} from "./events/WorldEvents.js";
export type { PlayerPersistenceSnapshot };
import {
  EntityFactory,
  instantiatePrefab,
  type SpawnPlayerOptions,
  type SpawnProjectileOptions,
} from "./ecs/EntityFactory.js";
import { EntityManager } from "./ecs/EntityManager.js";
import { CommandQueue } from "./commands/CommandQueue.js";
import type { PlayerCommand } from "./commands/PlayerCommand.js";
import {
  TickBuffer,
  type WorldTickResult,
  type EntityDeathRecord,
  type PlayerLevelUpRecord,
  type WorldTransferRecord,
} from "./tick/TickBuffer.js";
import { SpatialSystem } from "./systems/SpatialSystem.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { CombatSystem } from "./systems/CombatSystem.js";
import { DamageSystem } from "./systems/DamageSystem.js";
import { DeathAndLootSystem } from "./systems/DeathAndLootSystem.js";
import { MonsterAISystem } from "./systems/MonsterAISystem.js";
import { SpawnerSystem } from "./systems/SpawnerSystem.js";
import { LootSystem } from "./systems/LootSystem.js";
import { InventorySystem } from "./systems/InventorySystem.js";
import { AOISystem } from "./systems/AOISystem.js";
import { CommandProcessingSystem } from "./systems/CommandProcessingSystem.js";

export class GameWorld {
  public readonly worldId: string;
  public readonly mapData: MapData;
  public readonly events: EventBus<WorldEventMap>;

  public currentTick: number = 0;

  // bitECS 0.4 World & UUID Index Bridge
  public readonly ecsWorld: World;
  public readonly uuidToEid: Map<string, number> = new Map();

  // Centralized Entity Manager & Lifecycle
  public readonly entities: EntityManager;

  // Command Ingestion & Tick Output Buffers
  public readonly commandQueue: CommandQueue = new CommandQueue();
  public readonly tickBuffer: TickBuffer = new TickBuffer();

  // Subsystems
  public readonly commands: CommandProcessingSystem;
  public readonly spatial: SpatialSystem;
  public readonly movement: MovementSystem;
  public readonly combat: CombatSystem;
  public readonly damage: DamageSystem;
  public readonly deathAndLoot: DeathAndLootSystem;
  public readonly monstersAI: MonsterAISystem;
  public readonly spawnerSystem: SpawnerSystem;
  public readonly loot: LootSystem;
  public readonly inventory: InventorySystem;
  public readonly aoi: AOISystem;

  constructor(worldId: string, mapData: MapData) {
    this.worldId = worldId;
    this.mapData = mapData;
    this.events = new EventBus<WorldEventMap>();

    // Instantiate bitECS World
    this.ecsWorld = createWorld();

    // Instantiate Entity Manager
    this.entities = new EntityManager(this);

    // Instantiate Subsystems
    this.commands = new CommandProcessingSystem();
    this.spatial = new SpatialSystem(4);
    this.movement = new MovementSystem();
    this.combat = new CombatSystem();
    this.damage = new DamageSystem();
    this.deathAndLoot = new DeathAndLootSystem();
    this.monstersAI = new MonsterAISystem();
    this.spawnerSystem = new SpawnerSystem();
    this.loot = new LootSystem();
    this.inventory = new InventorySystem();
    this.aoi = new AOISystem();

    // Spawn static map entities into the bitECS world
    if (this.mapData.entities) {
      for (const entDef of this.mapData.entities) {
        const prefab = getPrefab(entDef.prefabId);
        if (!prefab) {
          throw new Error(
            `Map ${this.mapData.id} references unknown prefab: ${entDef.prefabId}`,
          );
        }
        const eid = instantiatePrefab(this.ecsWorld, prefab, entDef.overrides);
        const uuid = Identity.uuid[eid];
        if (uuid) {
          this.uuidToEid.set(uuid, eid);
        }
        if (Position.x[eid] !== undefined && Position.y[eid] !== undefined) {
          this.spatial.insert(eid, Position.x[eid], Position.y[eid]);
        }
      }
    }

    // Initialize Spawners & initial monster populations
    this.spawnerSystem.init(this);
  }

  // --- Tick Output Recording & Event Emission ---

  public recordSpawnedProjectile(bullet: ProjectileState): void {
    this.tickBuffer.bullets.push(bullet);
    this.events.emit("bullet_spawned", {
      worldId: this.worldId,
      bullet,
    });
  }

  public recordDamageDealt(event: DamageEvent): void {
    this.tickBuffer.damageEvents.push(event);
    this.events.emit("damage_dealt", {
      worldId: this.worldId,
      event,
    });
  }

  public recordEntityDied(record: EntityDeathRecord): void {
    this.tickBuffer.deaths.push(record);
    this.events.emit("entity_died", {
      worldId: this.worldId,
      ...record,
    });
  }

  public recordLevelUp(record: PlayerLevelUpRecord): void {
    this.tickBuffer.levelUps.push(record);
    this.events.emit("player_level_up", record);
  }

  public recordWorldTransfer(record: WorldTransferRecord): void {
    this.tickBuffer.transfers.push(record);
    this.events.emit("world_transfer_requested", record);
  }

  public recordLootBagSpawned(record: LootBagSpawnedEvent): void {
    this.tickBuffer.lootBagsSpawned.push(record);
    this.events.emit("loot_bag_spawned", record);
  }

  public recordLootBagDespawned(record: LootBagDespawnedEvent): void {
    this.tickBuffer.lootBagsDespawned.push(record);
    this.events.emit("loot_bag_despawned", record);
  }

  public recordSnapshot(snapshot: SnapshotEvent): void {
    this.tickBuffer.snapshot = snapshot;
    this.events.emit("snapshot", snapshot);
  }

  // --- Command Ingestion ---

  public enqueueCommand(playerId: string, command: PlayerCommand): void {
    this.commandQueue.enqueue(playerId, command);
  }

  public get activeBullets(): ProjectileState[] {
    const bullets = query(this.ecsWorld, [ProjectileTag, Position, Projectile]);
    return Array.from(bullets).map((eid) => ({
      id: Identity.uuid[eid],
      ownerId:
        Identity.uuid[Projectile.ownerEid[eid]] ??
        String(Projectile.ownerEid[eid]),
      isPlayer: Projectile.isPlayer[eid],
      startX: Projectile.startX[eid],
      startY: Projectile.startY[eid],
      angle: Position.angle[eid],
      speed: Projectile.speed[eid],
      lifetime: Projectile.lifetime[eid],
      damage: Projectile.damage[eid],
      spawnTime: Projectile.spawnTime[eid],
      color: Projectile.color[eid],
      radius: 0.3,
      piercing: Projectile.piercing[eid],
      prefabId: Projectile.prefabId[eid],
      shape: Projectile.shape[eid],
    }));
  }

  public isSolid(tx: number, ty: number): boolean {
    return isSolidTile(this.mapData, tx, ty);
  }

  // --- Entity Management Shortcuts (delegating to EntityManager) ---

  public addPlayer(options: SpawnPlayerOptions): number {
    return this.entities.spawnPlayer(options);
  }

  public removePlayer(playerId: string): number | undefined {
    return this.entities.destroyEntityByUuid(playerId);
  }

  public spawnMonster(
    subtype: string,
    x: number,
    y: number,
    spawnerEid?: number | null,
  ): number {
    return this.entities.spawnMonster(subtype, x, y, spawnerEid);
  }

  public removeMonster(monsterId: string): void {
    this.entities.destroyEntityByUuid(monsterId);
  }

  public spawnProjectile(options: SpawnProjectileOptions): number {
    return this.entities.spawnProjectile(options);
  }

  /**
   * Advances the simulation by dt seconds (normally 1/30).
   * Returns a WorldTickResult capturing all deltas produced during this tick.
   */
  public tick(dt: number = 1 / 30, now: number = Date.now()): WorldTickResult {
    this.currentTick++;
    this.tickBuffer.clear();

    // 1. Process queued player inputs and interaction commands
    this.commands.update(this, dt, now);

    // 2. Spawner Phase: Spawner timers & monster spawning
    this.spawnerSystem.update(this, dt, now);

    // 3. Intent Phase: Monster AI decisions & intent
    this.monstersAI.update(this, dt, now);

    // 4. Movement & Physics Phase: Player inputs and universal physics simulation
    this.movement.update(this, dt, now);

    // 5. Keep spatial grid synchronized
    this.spatial.update(this, dt, now);

    // 6. Update projectiles & queue collision damage
    this.combat.update(this, dt, now);

    // 7. Resolve queued damage & attach Dead tags
    this.damage.update(this, dt, now);

    // 8. Death handling, loot bag dropping & entity cleanup
    this.deathAndLoot.update(this, dt, now);

    // 9. Update loot bag expiration
    this.loot.update(this, dt, now);

    // 10. Build and emit network replication snapshot
    this.aoi.update(this, dt, now);

    // 11. Periodic state persistence emit (every 150 ticks = 5 seconds)
    if (this.currentTick % 150 === 0) {
      const players = query(this.ecsWorld, [
        Player,
        Position,
        Health,
        Progression,
        Equipment,
        Inventory,
      ]);

      for (const pEid of players) {
        this.events.emit("player_state_persist", {
          playerId: Identity.uuid[pEid],
          state: {
            hp: Health.current[pEid],
            mp: 100,
            level: Progression.level[pEid],
            xp: Progression.xp[pEid],
            x: Position.x[pEid],
            y: Position.y[pEid],
            currentWorld: this.worldId,
            isAlive: Health.current[pEid] > 0,
            equippedWeapon: Equipment.weapon[pEid] ?? null,
            equippedArmor: Equipment.armor[pEid] ?? null,
            inventory: JSON.stringify(
              Inventory.slots[pEid] || new Array(8).fill(null),
            ),
          },
        });
      }
    }

    return this.tickBuffer.toResult(this.worldId, this.currentTick, now);
  }

  // --- State Persistence Query (Decoupled from tick loop) ---

  public getPlayerPersistenceStates(): {
    playerId: string;
    state: PlayerPersistenceSnapshot;
  }[] {
    const players = query(this.ecsWorld, [
      Player,
      Position,
      Health,
      Progression,
      Equipment,
      Inventory,
    ]);

    const results: { playerId: string; state: PlayerPersistenceSnapshot }[] =
      [];
    for (const pEid of players) {
      results.push({
        playerId: Identity.uuid[pEid],
        state: {
          hp: Health.current[pEid],
          mp: 100,
          level: Progression.level[pEid],
          xp: Progression.xp[pEid],
          x: Position.x[pEid],
          y: Position.y[pEid],
          currentWorld: this.worldId,
          isAlive: Health.current[pEid] > 0,
          equippedWeapon: Equipment.weapon[pEid] ?? null,
          equippedArmor: Equipment.armor[pEid] ?? null,
          inventory: JSON.stringify(
            Inventory.slots[pEid] || new Array(8).fill(null),
          ),
        },
      });
    }
    return results;
  }

  public getPlayerPersistenceState(
    playerId: string,
  ): PlayerPersistenceSnapshot | null {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player)) {
      return null;
    }

    return {
      hp: Health.current[eid],
      mp: 100,
      level: Progression.level[eid],
      xp: Progression.xp[eid],
      x: Position.x[eid],
      y: Position.y[eid],
      currentWorld: this.worldId,
      isAlive: Health.current[eid] > 0,
      equippedWeapon: Equipment.weapon[eid] ?? null,
      equippedArmor: Equipment.armor[eid] ?? null,
      inventory: JSON.stringify(
        Inventory.slots[eid] || new Array(8).fill(null),
      ),
    };
  }

  // --- Direct Player Action Handlers (for backward compatibility / testing) ---

  public handleInput(playerId: string, input: PlayerInputItem): void {
    const eid = this.uuidToEid.get(playerId);
    if (eid !== undefined && hasComponent(this.ecsWorld, eid, Player)) {
      if (Health.current[eid] > 0) {
        if (!InputQueue.inputs[eid]) {
          InputQueue.inputs[eid] = [];
        }
        InputQueue.inputs[eid].push(input);
      }
    }
  }

  public handleShoot(playerId: string, angle: number): void {
    const eid = this.uuidToEid.get(playerId);
    if (eid !== undefined && hasComponent(this.ecsWorld, eid, Player)) {
      this.combat.handleShoot(this, eid, angle);
    }
  }

  public handleInteract(playerId: string): void {
    const eid = this.uuidToEid.get(playerId);
    if (eid !== undefined && hasComponent(this.ecsWorld, eid, Player)) {
      this.movement.handleInteract(this, eid);
    }
  }

  public handleLootItem(
    playerId: string,
    bagId: string,
    itemIndex?: number,
  ): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.loot.handleLootItem(this, eid, bagId, itemIndex);
  }

  public handleLootAll(playerId: string, bagId: string): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.loot.handleLootAll(this, eid, bagId);
  }

  public handleEquipItem(
    playerId: string,
    inventoryIndex: number,
    slot: "weapon" | "armor",
  ): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.inventory.handleEquipItem(this, eid, inventoryIndex, slot);
  }

  public handleUnequipItem(
    playerId: string,
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.inventory.handleUnequipItem(
      this,
      eid,
      slot,
      targetInventoryIndex,
    );
  }

  public handleSwapInventorySlots(
    playerId: string,
    fromIndex: number,
    toIndex: number,
  ): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.inventory.handleSwapSlots(this, eid, fromIndex, toIndex);
  }

  public handleDropItem(
    playerId: string,
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ): boolean {
    const eid = this.uuidToEid.get(playerId);
    if (eid === undefined || !hasComponent(this.ecsWorld, eid, Player))
      return false;
    return this.loot.handleDropItem(this, eid, fromSlot, inventoryIndex);
  }

  public destroy(): void {
    this.commandQueue.clear();
    this.tickBuffer.clear();
    this.events.clear();
    this.spatial.clear();
    this.uuidToEid.clear();
  }
}
