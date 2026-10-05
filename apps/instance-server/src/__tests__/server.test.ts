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
import { SpatialSystem, EntityFactory, GameWorld } from "@mmoexile/simulation";
import { InstanceHost } from "../cluster/index.js";
import { CharacterMapper, prisma } from "../persistence/index.js";

describe("InstanceHost Lossless Transitions", () => {
  it("transfers player between instances while 100% preserving stats, equipment, and inventory", () => {
    const host = new InstanceHost();

    const { instanceId, zoneId, playerEid } = host.registerPlayer({
      playerId: "p_traveler",
      name: "Traveler",
      zoneId: "nexus",
      character: {
        class: "knight",
        level: 5,
        xp: 350,
        hp: 140,
        equippedWeapon: "sword_iron",
        equippedArmor: "armor_iron",
        inventory: JSON.stringify([
          "staff_fire",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ]),
      },
    });

    expect(zoneId).toBe("nexus");
    expect(instanceId).toMatch(/^nexus:[0-9a-f]{6}$/);
    expect(Progression.classId[playerEid]).toBe("knight");
    expect(Progression.level[playerEid]).toBe(5);
    expect(Health.current[playerEid]).toBe(140);
    expect(Equipment.weapon[playerEid]).toBe("sword_iron");
    expect(Inventory.slots[playerEid][0]).toBe("staff_fire");

    // Transfer to overworld
    expect(host.transferPlayer("p_traveler", "overworld")).toBe(true);

    const target = host.getInstanceForPlayer("p_traveler")!;
    expect(target.zone.id).toBe("overworld");
    expect(target.players.has("p_traveler")).toBe(true);
    const transferredEid = target.world.uuidToEid.get("p_traveler");

    expect(transferredEid).toBeDefined();
    // Verify zero data loss!
    expect(Progression.classId[transferredEid!]).toBe("knight");
    expect(Progression.level[transferredEid!]).toBe(5);
    expect(Progression.xp[transferredEid!]).toBe(350);
    expect(Health.current[transferredEid!]).toBe(140);
    expect(Equipment.weapon[transferredEid!]).toBe("sword_iron");
    expect(Equipment.armor[transferredEid!]).toBe("armor_iron");
    expect(Inventory.slots[transferredEid!][0]).toBe("staff_fire");

    // Verify removed from the old instance
    const source = host.getInstance(instanceId)!;
    expect(source.world.uuidToEid.has("p_traveler")).toBe(false);
    expect(source.players.has("p_traveler")).toBe(false);
    expect(source.state).toBe("empty");

    host.stop();
  });
});

describe("InstanceHost instance identity", () => {
  it("starts only the warm instances, with zone-prefixed ids", () => {
    const host = new InstanceHost();
    const instances = host.getAllInstances();

    // Only the nexus keeps a warm instance; other zones are created on demand.
    expect(instances.map((i) => i.zone.id)).toEqual(["nexus"]);
    for (const instance of instances) {
      expect(instance.id).toMatch(new RegExp(`^${instance.zone.id}:[0-9a-f]{6}$`));
      expect(instance.world.instanceId).toBe(instance.id);
      expect(instance.world.zoneId).toBe(instance.zone.id);
      expect(instance.state).toBe("empty");
    }
    host.stop();
  });

  it("runs several independent instances of the same zone", () => {
    const host = new InstanceHost();
    const a = host.createInstance("golem_dungeon", { ownerPartyId: "party_a" });
    const b = host.createInstance("golem_dungeon", { ownerPartyId: "party_b" });

    expect(a.id).not.toBe(b.id);
    expect(a.world).not.toBe(b.world);
    expect(a.ownerPartyId).toBe("party_a");
    expect(host.getInstancesForZone("golem_dungeon")).toHaveLength(2);
    host.stop();
  });

  it("tracks players and the empty state per instance", () => {
    let clock = 1000;
    const host = new InstanceHost({ now: () => clock });
    const { instanceId } = host.registerPlayer({
      playerId: "p1",
      name: "One",
      zoneId: "nexus",
    });
    const instance = host.getInstance(instanceId)!;
    expect(instance.state).toBe("running");
    expect(instance.emptySince).toBeUndefined();

    clock = 5000;
    host.unregisterPlayer("p1");
    expect(instance.players.size).toBe(0);
    expect(instance.state).toBe("empty");
    expect(instance.emptySince).toBe(5000);
    host.stop();
  });

  it("falls back to the nexus for unknown zones", () => {
    const host = new InstanceHost();
    const { zoneId } = host.registerPlayer({
      playerId: "p_lost",
      name: "Lost",
      zoneId: "realm_1",
    });
    expect(zoneId).toBe("nexus");
    expect(host.transferPlayer("p_lost", "does_not_exist")).toBe(false);
    host.stop();
  });
});

describe("InstanceHost placement", () => {
  const golemPortal = (sourceInstanceId: string) => ({
    sourceInstanceId,
    portalId: "portal_to_dungeon_1",
  });

  it("sends solo players into separate golem dungeons", () => {
    const host = new InstanceHost();
    const a = host.registerPlayer({ playerId: "a", name: "A" });
    const b = host.registerPlayer({ playerId: "b", name: "B" });

    expect(host.transferPlayer("a", "golem_dungeon", golemPortal(a.instanceId))).toBe(true);
    expect(host.transferPlayer("b", "golem_dungeon", golemPortal(b.instanceId))).toBe(true);

    const dungeonA = host.getInstanceForPlayer("a")!;
    const dungeonB = host.getInstanceForPlayer("b")!;
    expect(dungeonA.zone.id).toBe("golem_dungeon");
    expect(dungeonB.zone.id).toBe("golem_dungeon");
    expect(dungeonA.id).not.toBe(dungeonB.id);
    // Each player only exists in their own dungeon's simulation
    expect(dungeonA.world.uuidToEid.has("b")).toBe(false);
    expect(dungeonB.world.uuidToEid.has("a")).toBe(false);
    host.stop();
  });

  it("returns a solo player to their own dungeon", () => {
    const host = new InstanceHost();
    const a = host.registerPlayer({ playerId: "a", name: "A" });
    host.transferPlayer("a", "golem_dungeon", golemPortal(a.instanceId));
    const dungeon = host.getInstanceForPlayer("a")!;

    host.transferPlayer("a", "nexus");
    host.transferPlayer("a", "golem_dungeon", golemPortal(a.instanceId));

    expect(host.getInstanceForPlayer("a")!.id).toBe(dungeon.id);
    host.stop();
  });

  it("opens a second nexus shard once the first reaches its soft cap", () => {
    const host = new InstanceHost();
    const softCap = (ZONES.nexus.access as { softCap: number }).softCap;

    for (let i = 0; i <= softCap; i++) {
      host.registerPlayer({ playerId: `p${i}`, name: `P${i}` });
    }

    const shards = host.getInstancesForZone("nexus");
    expect(shards).toHaveLength(2);
    expect(shards.map((s) => s.players.size).sort((x, y) => x - y)).toEqual([
      1,
      softCap,
    ]);
    host.stop();
  });

  it("logs players into the nexus instead of private zones", () => {
    const host = new InstanceHost();
    const { zoneId } = host.registerPlayer({
      playerId: "a",
      name: "A",
      zoneId: "golem_dungeon",
    });
    expect(zoneId).toBe("nexus");
    expect(host.getInstancesForZone("golem_dungeon")).toHaveLength(0);
    host.stop();
  });
});

describe("Character equipment rules", () => {
  it("supports fully unequipped player and correctly recalculates effective stats", () => {
    const wizard = createDefaultCharacter("NakedWizard", "wizard", "w1");
    wizard.equipment.weapon = null;
    wizard.equipment.armor = null;

    expect(wizard.equipment.weapon).toBeNull();
    expect(wizard.equipment.armor).toBeNull();

    const base = computeBaseStatsForLevel("wizard", 1);
    const stats = computeEffectiveStats(base, wizard.equipment);
    expect(stats.defense).toBe(0);
    expect(stats.maxHp).toBe(100);

    // Equip magician robe
    expect(canEquipItem("wizard", "robe_magician", "armor").canEquip).toBe(
      true,
    );
    wizard.equipment.armor = "robe_magician";

    const updatedStats = computeEffectiveStats(base, wizard.equipment);
    expect(updatedStats.defense).toBe(6);
    expect(updatedStats.maxHp).toBe(125);

    // Unequip armor
    wizard.equipment.armor = null;
    expect(computeEffectiveStats(base, wizard.equipment).defense).toBe(0);
  });

  it("handles inventory slot swapping and ground item drop", () => {
    const hero = createDefaultCharacter("Looter", "wizard", "hero1");
    hero.inventory[0] = "staff_energy";
    hero.inventory[1] = "robe_apprentice";

    expect(hero.inventory[0]).toBe("staff_energy");
    expect(hero.inventory[1]).toBe("robe_apprentice");

    const temp = hero.inventory[0];
    hero.inventory[0] = hero.inventory[1];
    hero.inventory[1] = temp;

    expect(hero.inventory[0]).toBe("robe_apprentice");
    expect(hero.inventory[1]).toBe("staff_energy");

    const droppedItem = hero.inventory[1];
    hero.inventory[1] = null;
    expect(droppedItem).toBe("staff_energy");
    expect(hero.inventory[1]).toBeNull();
  });
});

describe("CharacterMapper", () => {
  it("maps between Prisma records and CharacterData models", async () => {
    const account = await prisma.account.create({
      data: { nickname: "MapperHero", refreshSecretHash: `mapper-${Date.now()}` },
    });
    const record = await prisma.character.create({
      data: { accountId: account.id, class: "knight", inventory: ["staff_fire", null, null, null, null, null, null, null] },
    });

    const domainChar = CharacterMapper.toDomain(record, "MapperHero");
    expect(domainChar.id).toBe(record.id);
    expect(domainChar.name).toBe("MapperHero");
    expect(domainChar.classId).toBe("knight");
    expect(domainChar.inventory).toHaveLength(8);
    expect(domainChar.inventory[0]).toBe("staff_fire");

    const update = CharacterMapper.toPersistenceUpdate({
      hp: 120,
      x: 35.5,
      y: 42.1,
      lastZoneId: "overworld",
      isAlive: true,
      inventory: domainChar.inventory,
    });
    expect(update).toMatchObject({ hp: 120, lastZoneId: "overworld" });
    expect(update.mp).toBeUndefined();
  });
});
