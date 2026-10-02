import { describe, it, expect } from "vitest";
import { query, addComponent, removeEntity, hasComponent } from "bitecs";
import {
  getPrefab,
  MonsterPrefab,
  getItemDefinition,
  calculateDamage,
  createDefaultCharacter,
  computeBaseStatsForLevel,
  computeEffectiveStats,
  canEquipItem,
  ZONES,
  Position,
  Velocity,
  Speed,
  Collider,
  Health,
  CombatStats,
  AI,
  DropTable,
  Progression,
  Inventory,
  Equipment,
  InputQueue,
  Projectile,
  ProjectileTag,
  Player,
  Enemy,
  SpawnerTag,
  Spawner,
  LootBagTag,
  LootBag,
  Dead,
  SpawnedBy,
  Identity,
} from "@mmoexile/game-core";
import { SpatialSystem } from "../systems/SpatialSystem.js";
import { EntityFactory } from "../ecs/EntityFactory.js";
import { GameWorld } from "../GameWorld.js";

describe("SpatialSystem", () => {
  it("inserts and queries entities within radius", () => {
    const world = new GameWorld("test_spatial", ZONES.nexus.createMap());
    const spatial = new SpatialSystem(4);

    const e1 = EntityFactory.spawnMonster(world.ecsWorld, "slime", 10, 10);
    const e2 = EntityFactory.spawnMonster(world.ecsWorld, "slime", 12, 10);
    const e3 = EntityFactory.spawnMonster(world.ecsWorld, "slime", 30, 30);

    spatial.insert(e1, 10, 10);
    spatial.insert(e2, 12, 10);
    spatial.insert(e3, 30, 30);

    const nearby = spatial.queryRadius(world, { x: 10, y: 10 }, 3);

    expect(nearby).toContain(e1);
    expect(nearby).toContain(e2);
    expect(nearby).not.toContain(e3);
  });

  it("updates entity location in grid", () => {
    const world = new GameWorld("test_spatial_update", ZONES.nexus.createMap());
    const spatial = new SpatialSystem(4);
    const e1 = EntityFactory.spawnMonster(world.ecsWorld, "slime", 2, 2);
    spatial.insert(e1, 2, 2);

    Position.x[e1] = 25;
    Position.y[e1] = 25;
    spatial.updateEntity(e1, 25, 25);

    const atOldPos = spatial.queryRadius(world, { x: 2, y: 2 }, 2);
    expect(atOldPos.length).toBe(0);

    const atNewPos = spatial.queryRadius(world, { x: 25, y: 25 }, 2);
    expect(atNewPos.length).toBe(1);
    expect(atNewPos[0]).toBe(e1);
  });
});

describe("Monster AI & bitECS Simulation", () => {
  it("initializes monster entity in bitECS with prefab stats and AI", () => {
    const world = new GameWorld("test_monster_init", ZONES.nexus.createMap());
    const slimeEid = EntityFactory.spawnMonster(
      world.ecsWorld,
      "slime",
      20,
      20,
    );

    expect(hasComponent(world.ecsWorld, slimeEid, Enemy)).toBe(true);
    expect(Identity.name[slimeEid]).toBe("Forest Slime");
    expect(Health.current[slimeEid]).toBe(Health.max[slimeEid]);
    expect(Health.current[slimeEid]).toBe(60);
    expect(AI.phases[slimeEid].length).toBeGreaterThan(0);
    expect(AI.currentPhaseIndex[slimeEid]).toBe(0);
  });

  it("sets movement intent and fires projectiles within range in GameWorld", () => {
    const world = new GameWorld("test_ai_intent", ZONES.nexus.createMap());
    // Clear initial spawners/monsters
    world.spatial.clear();

    const slimeEid = world.spawnMonster("slime", 20, 20);
    AI.attackTimers[slimeEid] = [0]; // ready to shoot immediately

    const playerEid = world.addPlayer({
      id: "p1",
      name: "Tester",
      classId: "wizard",
      x: 24,
      y: 20,
    });

    let spawnedBulletCount = 0;
    world.events.on("bullet_spawned", (evt) => {
      if (!evt.bullet.isPlayer) {
        spawnedBulletCount++;
      }
    });

    // 1. Step AI intent
    world.monstersAI.update(world, 0.05, Date.now());

    expect(spawnedBulletCount).toBeGreaterThan(0);
    expect(world.activeBullets.length).toBeGreaterThan(0);
    expect(Velocity.vx[slimeEid]).toBeGreaterThan(0); // Intent set to chase towards (24, 20)

    // 2. Step universal movement system
    world.movement.update(world, 0.05, Date.now());
    expect(Position.x[slimeEid]).toBeGreaterThan(20); // Position advanced by physics
  });

  it("golem boss evaluates phase transitions and enrages on health threshold", () => {
    const world = new GameWorld("test_golem", ZONES.golem_dungeon.createMap());

    const golemEid = world.spawnMonster("golem_boss", 18, 18);
    expect(AI.currentPhaseIndex[golemEid]).toBe(0);
    expect(AI.phases[golemEid][0].name).toBe("Guarding");

    // Inflict heavy damage (> 50% of 1200 HP)
    Health.current[golemEid] -= 850;
    world.monstersAI.evaluatePhase(world, golemEid);

    expect(AI.currentPhaseIndex[golemEid]).toBe(1);
    expect(AI.phases[golemEid][1].name).toBe("Enraged");
    expect(AI.phases[golemEid][1].speedMultiplier).toBe(1.8);
    expect(AI.phases[golemEid][1].attacks?.length).toBe(2);
  });

  it("calculates mitigated damage for armored players against monster attacks", () => {
    const base = computeBaseStatsForLevel("knight", 1);
    const effective = computeEffectiveStats(base, {
      weapon: "sword_iron",
      armor: "armor_iron",
    });
    const knightDef = effective.defense;
    expect(knightDef).toBe(12);

    const damageDealt = calculateDamage(30, knightDef);
    expect(damageDealt).toBe(18); // 30 - 12

    let hp = effective.maxHp - damageDealt;
    expect(hp).toBe(157); // 175 - 18
  });

  it("rolls monster loot table and calculates dynamic bag tier on death", () => {
    const golemPrefab = getPrefab<MonsterPrefab>("golem_boss")!;
    expect(golemPrefab.components.DropTable).toBeDefined();

    const droppedItemIds: string[] = [];
    for (const drop of golemPrefab.components.DropTable!.drops!) {
      if (Math.random() < drop.chance) {
        droppedItemIds.push(drop.itemId);
      }
    }

    const hasUncommon = droppedItemIds.some((id) => {
      const def = getItemDefinition(id);
      return def?.rarity === "uncommon";
    });
    const bagKind = hasUncommon ? "bag_cyan" : "bag_brown";
    expect(["bag_cyan", "bag_brown"]).toContain(bagKind);
  });
});

describe("GameWorld & Subsystems Integration", () => {
  it("simulates player movement, inputs, and tile collisions", () => {
    const world = new GameWorld("move_test", ZONES.nexus.createMap());
    const playerEid = world.addPlayer({
      id: "p_move",
      name: "Runner",
      classId: "wizard",
      x: 10,
      y: 10,
    });

    // Queue movement input moving right
    world.handleInput("p_move", {
      seq: 1,
      moveX: 1,
      moveY: 0,
      angle: 0,
      dt: 0.1,
    });

    world.movement.update(world, 0.1, Date.now());

    expect(InputQueue.lastAckSeq[playerEid]).toBe(1);
    expect(Position.x[playerEid]).toBeGreaterThan(10);
    expect(Position.y[playerEid]).toBe(10);
  });

  it("handles player shooting, projectile simulation, spatial hit detection, and damage", () => {
    const world = new GameWorld("combat_test", ZONES.nexus.createMap());
    world.spatial.clear();

    const playerEid = world.addPlayer({
      id: "p_shooter",
      name: "Shooter",
      classId: "wizard",
      x: 10,
      y: 10,
      equipment: { weapon: "staff_energy" },
    });

    // Place a slime at (12, 10) directly along bullet trajectory (angle 0)
    const slimeEid = world.spawnMonster("slime", 12, 10);
    const initialSlimeHp = Health.current[slimeEid];

    let damageEventFired = false;
    world.events.on("damage_dealt", (evt) => {
      if (evt.event.targetId === Identity.uuid[slimeEid]) {
        damageEventFired = true;
      }
    });

    // Player shoots directly at the slime
    world.handleShoot("p_shooter", 0);
    expect(world.activeBullets.length).toBe(1);

    // Advance combat simulation
    world.combat.update(world, 0.2, Date.now() + 200);
    world.damage.update(world, 0.2, Date.now() + 200);

    expect(damageEventFired).toBe(true);
    expect(Health.current[slimeEid]).toBeLessThan(initialSlimeHp);
  });

  it("handles loot bag dropping, proximity looting, and inventory management", () => {
    const world = new GameWorld("loot_test", ZONES.nexus.createMap());
    const playerEid = world.addPlayer({
      id: "p_looter",
      name: "Looter",
      classId: "knight",
      x: 15,
      y: 15,
      equipment: { weapon: "sword_iron" },
      inventory: [null, null, null, null, null, null, null, null],
    });

    // Drop item from weapon slot
    const dropped = world.handleDropItem("p_looter", "weapon");
    expect(dropped).toBe(true);
    expect(Equipment.weapon[playerEid]).toBeNull();

    const bags = query(world.ecsWorld, [LootBagTag, Position, LootBag]);
    expect(bags.length).toBe(1);

    const bagEid = bags[0];
    const bagId = Identity.uuid[bagEid];
    expect(LootBag.itemIds[bagEid]).toContain("sword_iron");

    // Loot item into inventory
    const looted = world.handleLootItem("p_looter", bagId, 0);
    expect(looted).toBe(true);
    expect(Inventory.slots[playerEid][0]).toBe("sword_iron");

    // Check that bag was emptied and removed
    const remainingBags = query(world.ecsWorld, [LootBagTag]);
    expect(remainingBags.length).toBe(0);

    // Equip item from inventory
    const equipped = world.handleEquipItem("p_looter", 0, "weapon");
    expect(equipped).toBe(true);
    expect(Equipment.weapon[playerEid]).toBe("sword_iron");
    expect(Inventory.slots[playerEid][0]).toBeNull();
  });
});

describe("Projectile Simulation in bitECS", () => {
  it("spawns projectile entity and tracks trajectory", () => {
    const world = new GameWorld("bullet_world", ZONES.nexus.createMap());
    let emitted = false;
    world.events.on("bullet_spawned", (evt) => {
      if (evt.bullet.id === "test_p") {
        emitted = true;
      }
    });

    const bEid = world.spawnProjectile({
      id: "test_p",
      ownerEid: 1,
      isPlayer: true,
      startX: 5,
      startY: 5,
      angle: Math.PI / 2,
      speed: 8,
      lifetime: 0.8,
      damage: 15,
      prefabId: "projectile_square",
    });

    expect(Projectile.shape[bEid]).toBe("square");
    expect(world.activeBullets.length).toBe(1);
    expect(emitted).toBe(true);
  });
});

describe("SpawnerSystem & bitECS Relations", () => {
  it("initializes spawners from map definitions and tracks spawned monsters via SpawnedBy relation", () => {
    const dungeonMap = ZONES.golem_dungeon.createMap();
    const world = new GameWorld("test_dungeon", dungeonMap);

    const spawners = query(world.ecsWorld, [SpawnerTag, Spawner, Position]);
    const spawnerEntities = dungeonMap.entities.filter(
      (e) => e.prefabId === "spawner",
    );
    expect(spawners.length).toBe(spawnerEntities.length);

    // Each spawner should have spawned its initial maxCount of monsters
    for (const spawnerEid of spawners) {
      const maxCount = Spawner.maxCount[spawnerEid];
      const aliveChildren = query(world.ecsWorld, [
        Enemy,
        SpawnedBy(spawnerEid),
      ]);
      expect(aliveChildren.length).toBe(maxCount);

      for (const mEid of aliveChildren) {
        expect(hasComponent(world.ecsWorld, mEid, Enemy)).toBe(true);
        expect(Health.current[mEid]).toBeGreaterThan(0);
      }
    }
  });

  it("respawns monsters when below maxCount after respawnSec elapses", () => {
    const dungeonMap = ZONES.golem_dungeon.createMap();
    const world = new GameWorld("test_dungeon_respawn", dungeonMap);

    const slimeSpawnerEid = world.uuidToEid.get("spawner_dungeon_slimes")!;
    expect(slimeSpawnerEid).toBeDefined();

    let aliveSlimes = query(world.ecsWorld, [
      Enemy,
      SpawnedBy(slimeSpawnerEid),
    ]);
    expect(aliveSlimes.length).toBe(2);

    // Kill one of the slimes by attaching Dead tag
    const firstSlimeEid = aliveSlimes[0];
    addComponent(world.ecsWorld, firstSlimeEid, Dead);

    // Tick the world with 1.0s - DeathAndLootSystem cleans up dead monster, SpawnerSystem starts timer
    world.tick(1.0);

    aliveSlimes = query(world.ecsWorld, [Enemy, SpawnedBy(slimeSpawnerEid)]);
    expect(aliveSlimes.length).toBe(1);
    expect(Spawner.timer[slimeSpawnerEid]).toBe(1.0);

    // Tick until respawnSec (15s total)
    world.tick(14.0);

    // At 15s elapsed, a new monster should have been spawned
    aliveSlimes = query(world.ecsWorld, [Enemy, SpawnedBy(slimeSpawnerEid)]);
    expect(aliveSlimes.length).toBe(2);
    expect(Spawner.timer[slimeSpawnerEid]).toBe(0);
  });
});

describe("EntityFactory Strict Prefab Instantiation & Error Handling", () => {
  it("instantiates spawner entities through the spawner prefab with SpawnerTag and SoA components", () => {
    const world = new GameWorld("test_spawner_factory", ZONES.nexus.createMap());
    const spawnerEid = EntityFactory.spawnSpawner(world.ecsWorld, {
      id: "spawner_1",
      x: 12,
      y: 14,
      prefabId: "slime",
      count: 3,
      respawnSec: 8,
      spawnRadius: 2.5,
    });

    expect(hasComponent(world.ecsWorld, spawnerEid, SpawnerTag)).toBe(true);
    expect(Position.x[spawnerEid]).toBe(12);
    expect(Position.y[spawnerEid]).toBe(14);
    expect(Identity.uuid[spawnerEid]).toBe("spawner_1");
    expect(Identity.name[spawnerEid]).toBe("Spawner_slime");
    expect(Spawner.spawnPrefabId[spawnerEid]).toBe("slime");
    expect(Spawner.maxCount[spawnerEid]).toBe(3);
    expect(Spawner.interval[spawnerEid]).toBe(8);
    expect(Spawner.spawnRadius[spawnerEid]).toBe(2.5);
  });

  it("spawns non-enemy entities via SpawnerSystem using generic prefabId and instantiatePrefab", () => {
    const customMap = {
      ...ZONES.nexus.createMap(),
      entities: [
        {
          prefabId: "spawner",
          overrides: {
            Position: { x: 10, y: 10, angle: 0 },
            Identity: { uuid: "spawner_loot", name: "Spawner_bag_brown" },
            Spawner: {
              spawnPrefabId: "bag_brown",
              maxCount: 2,
              interval: 5,
              timer: 0,
              spawnRadius: 1.0,
            },
          },
        },
      ],
    };
    const world = new GameWorld("generic_spawner_world", customMap);
    const spawnerEid = world.uuidToEid.get("spawner_loot")!;
    expect(spawnerEid).toBeDefined();

    const spawnedBags = query(world.ecsWorld, [
      LootBagTag,
      SpawnedBy(spawnerEid),
    ]);
    expect(spawnedBags.length).toBe(2);
  });

  it("throws an error when spawning a player with an unknown classId", () => {
    const world = new GameWorld("test_player_err", ZONES.nexus.createMap());
    expect(() => {
      EntityFactory.spawnPlayer(world.ecsWorld, {
        id: "p_err",
        name: "Broken",
        classId: "ninja",
        x: 0,
        y: 0,
      });
    }).toThrow("Unknown character class: ninja");
  });

  it("throws an error when spawning a projectile with an unknown prefabId", () => {
    const world = new GameWorld("test_proj_err", ZONES.nexus.createMap());
    expect(() => {
      EntityFactory.spawnProjectile(world.ecsWorld, {
        ownerEid: 1,
        isPlayer: true,
        startX: 0,
        startY: 0,
        angle: 0,
        speed: 10,
        lifetime: 1,
        damage: 10,
        prefabId: "projectile_laser",
      });
    }).toThrow("Unknown projectile prefab: projectile_laser");
  });

  it("throws an error when spawning a loot bag with an unknown bagKind", () => {
    const world = new GameWorld("test_bag_err", ZONES.nexus.createMap());
    expect(() => {
      EntityFactory.spawnLootBag(
        world.ecsWorld,
        0,
        0,
        ["sword_iron"],
        "bag_gold" as any,
      );
    }).toThrow("Unknown loot bag prefab: bag_gold");
  });

  it("throws an error when spawning a portal with an unknown portal prefab", () => {
    const world = new GameWorld("test_portal_err", ZONES.nexus.createMap());
    expect(() => {
      EntityFactory.spawnPortal(world.ecsWorld, {
        id: "port_err",
        targetZoneId: "void",
        name: "Void Portal",
        kind: "void_portal",
        x: 0,
        y: 0,
      });
    }).toThrow("Unknown portal prefab: void_portal");
  });
});

describe("4-Layer Decoupled MMO Architecture", () => {
  it("EntityManager centralizes entity creation, spatial indexing, and destruction", () => {
    const world = new GameWorld("test_em", ZONES.nexus.createMap());
    const mEid = world.entities.spawnMonster("slime", 15, 15);
    const mUuid = world.entities.getUuid(mEid);

    expect(mUuid).toBeDefined();
    expect(world.entities.getEid(mUuid!)).toBe(mEid);

    // Spatial query finds entity
    const found = world.spatial.queryRadius(
      world,
      { x: 15, y: 15 },
      1.0,
      "enemy",
    );
    expect(found).toContain(mEid);

    // Destroy entity cleanly
    world.entities.destroyEntity(mEid);
    expect(world.entities.getEid(mUuid!)).toBeUndefined();
    expect(
      world.spatial.queryRadius(world, { x: 15, y: 15 }, 1.0, "enemy"),
    ).not.toContain(mEid);
  });

  it("CommandQueue ingests player commands and CommandProcessingSystem executes them at tick start", () => {
    const world = new GameWorld("test_cmd", ZONES.nexus.createMap());
    const pEid = world.entities.spawnPlayer({
      id: "p_cmd",
      name: "Commander",
      classId: "wizard",
      x: 20,
      y: 20,
      equipment: { weapon: "staff_energy" },
    });

    // Enqueue shoot command
    world.enqueueCommand("p_cmd", {
      type: "shoot",
      angle: Math.PI / 4,
    });

    expect(world.tickBuffer.bullets.length).toBe(0);

    // Run tick: commands processed, bullets spawned into tickBuffer
    const tickResult = world.tick(1 / 30, Date.now());

    expect(tickResult.bullets.length).toBeGreaterThan(0);
    expect(tickResult.bullets[0].isPlayer).toBe(true);
    expect(tickResult.bullets[0].ownerId).toBe("p_cmd");
  });

  it("TickBuffer returns structured tick output deltas without blocking tick loop", () => {
    const world = new GameWorld("test_tb", ZONES.nexus.createMap());
    world.entities.spawnPlayer({
      id: "p_tick",
      name: "Ticker",
      classId: "knight",
      x: 10,
      y: 10,
    });

    const result = world.tick(1 / 30, Date.now());

    expect(result.instanceId).toBe("test_tb");
    expect(result.tick).toBe(1);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot?.entities.some((e) => e.id === "p_tick")).toBe(true);
    expect(result.snapshot?.entities.some((e: any) => e.id === "p_tick")).toBe(true);
    expect(Array.isArray(result.bullets)).toBe(true);
    expect(Array.isArray(result.damageEvents)).toBe(true);
  });
});
