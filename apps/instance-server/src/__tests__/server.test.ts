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
  STATIC_MAPS,
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
import { WorldCluster, WorldManager } from "../cluster/index.js";
import {
  accountRepo,
  characterRepo,
  CharacterMapper,
  accountService,
} from "../persistence/index.js";

describe("WorldManager Lossless Transitions", () => {
  it("transfers player between worlds while 100% preserving stats, equipment, and inventory", () => {
    const manager = new WorldManager();

    const mockSocket = {
      readyState: 1,
      send: () => {},
    } as any;

    const { worldId, playerEid } = manager.registerPlayer(
      mockSocket,
      "p_traveler",
      "Traveler",
      "p_traveler",
      "nexus",
      {
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
    );

    expect(worldId).toBe("nexus");
    expect(Progression.classId[playerEid]).toBe("knight");
    expect(Progression.level[playerEid]).toBe(5);
    expect(Health.current[playerEid]).toBe(140);
    expect(Equipment.weapon[playerEid]).toBe("sword_iron");
    expect(Inventory.slots[playerEid][0]).toBe("staff_fire");

    // Transfer to realm_1
    manager.transferPlayer("p_traveler", "realm_1");

    const realmWorld = manager.getWorld("realm_1")!;
    const transferredEid = realmWorld.uuidToEid.get("p_traveler");

    expect(transferredEid).toBeDefined();
    // Verify zero data loss!
    expect(Progression.classId[transferredEid!]).toBe("knight");
    expect(Progression.level[transferredEid!]).toBe(5);
    expect(Progression.xp[transferredEid!]).toBe(350);
    expect(Health.current[transferredEid!]).toBe(140);
    expect(Equipment.weapon[transferredEid!]).toBe("sword_iron");
    expect(Equipment.armor[transferredEid!]).toBe("armor_iron");
    expect(Inventory.slots[transferredEid!][0]).toBe("staff_fire");

    // Verify removed from old world
    const nexusWorld = manager.getWorld("nexus")!;
    expect(nexusWorld.uuidToEid.has("p_traveler")).toBe(false);

    manager.stop();
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
