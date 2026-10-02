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
import {
  accountRepo,
  characterRepo,
  CharacterMapper,
  accountService,
} from "../persistence/index.js";

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
  it("starts one instance per zone with unique zone-prefixed ids", () => {
    const host = new InstanceHost();
    const ids = host.getAllInstances().map((i) => i.id);

    expect(ids).toHaveLength(Object.keys(ZONES).length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const instance of host.getAllInstances()) {
      expect(instance.id.startsWith(`${instance.zone.id}:`)).toBe(true);
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
    expect(host.getInstancesForZone("golem_dungeon")).toHaveLength(3);
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

describe("Database & Account Persistence", () => {
  it("creates guest account with default wizard character", async () => {
    const { account, character } =
      await accountService.loginOrRegister("TestHero");

    expect(account.id).toBeDefined();
    expect(account.nickname).toBe("TestHero");
    expect(account.token).toBeDefined();
    expect(character).toBeDefined();
    expect(character.class).toBe("wizard");
    expect(character.hp).toBe(110);
    expect(character.maxHp).toBe(110);
    expect(character.defense).toBe(3);
    expect(character.equippedWeapon).toBe("staff_energy");
    expect(character.equippedArmor).toBe("robe_apprentice");
    expect(character.isAlive).toBe(true);

    const loaded = await accountService.loginOrRegister(
      "DifferentName",
      account.token,
    );
    expect(loaded.account.id).toBe(account.id);
    expect(loaded.character.id).toBe(character.id);

    const knightAcc = await accountService.loginOrRegister(
      "KnightHero",
      undefined,
      "knight",
    );
    expect(knightAcc.character.class).toBe("knight");
    expect(knightAcc.character.hp).toBe(175);
    expect(knightAcc.character.defense).toBe(12);
    expect(knightAcc.character.equippedWeapon).toBe("sword_iron");
    expect(knightAcc.character.equippedArmor).toBe("armor_iron");
  });

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

describe("Repository, Mapper & Service Layer", () => {
  it("creates and retrieves accounts via AccountRepository", async () => {
    const testToken = `repo_test_${Date.now()}`;
    const account = await accountRepo.createAccount({
      nickname: "RepoTester",
      token: testToken,
    });

    expect(account.id).toBeDefined();
    expect(account.nickname).toBe("RepoTester");

    const fetchedById = await accountRepo.findById(account.id);
    expect(fetchedById?.id).toBe(account.id);

    const fetchedByToken = await accountRepo.findByToken(testToken);
    expect(fetchedByToken?.id).toBe(account.id);
  });

  it("maps between Prisma records and CharacterData models via CharacterMapper", async () => {
    const loginResult = await accountService.loginOrRegister(
      "MapperHero",
      undefined,
      "wizard",
    );
    const prismaRecord = loginResult.character;

    const domainChar = CharacterMapper.toDomain(prismaRecord, "MapperHero");
    expect(domainChar.id).toBe(prismaRecord.id);
    expect(domainChar.classId).toBe("wizard");
    expect(domainChar.name).toBe("MapperHero");
    expect(domainChar.inventory).toHaveLength(8);
    expect(domainChar.equipment.weapon).toBe("staff_energy");

    const createInput = CharacterMapper.toPersistenceCreate(
      domainChar,
      loginResult.account.id,
      "nexus",
      25.0,
      30.0,
    );
    expect(createInput.class).toBe("wizard");
    expect(createInput.x).toBe(25.0);
    expect(createInput.y).toBe(30.0);
    expect(typeof createInput.inventory).toBe("string");
  });

  it("updates character state and handles death via CharacterRepository & AccountService", async () => {
    const { character } = await accountService.loginOrRegister(
      "UpdateHero",
      undefined,
      "knight",
    );

    await accountService.persistCharacterState(character.id, {
      hp: 120,
      mp: 20,
      x: 35.5,
      y: 42.1,
      currentWorld: "realm",
      isAlive: true,
      equippedWeapon: "sword_iron",
    });

    const updated = await characterRepo.findById(character.id);
    expect(updated?.hp).toBe(120);
    expect(updated?.mp).toBe(20);
    expect(updated?.x).toBe(35.5);
    expect(updated?.y).toBe(42.1);
    expect(updated?.currentWorld).toBe("realm");

    const deadChar = await characterRepo.markDead(character.id, "Slime Boss");
    expect(deadChar.isAlive).toBe(false);
    expect(deadChar.deathReason).toBe("Slime Boss");
  });
});
