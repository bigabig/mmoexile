import { describe, it, expect } from "vitest";
import {
  vec2,
  vec2Dist,
  resolveCircleTileCollision,
  circleIntersectsCircle,
  circleIntersectsAABB,
} from "../math/vec2.js";
import { BUILTIN_VOXEL_MODELS } from "../voxels/models/index.js";
import { getVoxel } from "../voxels/types.js";
import { ZONES, isZoneId } from "../zones/index.js";
import { isSolidTile } from "../maps/types.js";
import {
  TileType,
  WallType,
  isSolidTile as isSolidTileDirect,
} from "../maps/tiles.js";
import {
  getPrefab,
  PREFABS,
  CharacterClassPrefab,
  MonsterPrefab,
  ProjectilePrefab,
  PortalPrefab,
  LootBagPrefab,
} from "../prefabs/index.js";
import { getItemDefinition, ITEMS_REGISTRY } from "../items/index.js";
import { voxelModelToSvg, voxelModelToDataUrl } from "../voxels/thumbnail.js";
import {
  calculateDamage,
  applyDamage,
  createWeaponProjectiles,
  getWeaponAttackCooldown,
} from "../combat/index.js";
import {
  createDefaultCharacter,
  getClassDefinition,
  computeBaseStatsForLevel,
  computeEffectiveStats,
  canEquipItem,
  getXpForNextLevel,
} from "../characters/index.js";

describe("Shared Math & Collisions", () => {
  it("computes distance accurately", () => {
    const a = vec2(0, 0);
    const b = vec2(3, 4);
    expect(vec2Dist(a, b)).toBe(5);
  });

  it("detects circle-circle collision", () => {
    expect(circleIntersectsCircle(vec2(0, 0), 1, vec2(1.5, 0), 1)).toBe(true);
    expect(circleIntersectsCircle(vec2(0, 0), 1, vec2(3, 0), 1)).toBe(false);
  });

  it("detects circle-AABB collision", () => {
    expect(
      circleIntersectsAABB(vec2(0.5, 0.5), 0.5, vec2(0, 0), vec2(1, 1)),
    ).toBe(true);
    expect(
      circleIntersectsAABB(vec2(2.5, 0.5), 0.5, vec2(0, 0), vec2(1, 1)),
    ).toBe(false);
  });

  it("resolves circle-tile collision smoothly", () => {
    // Solid tile at (1, 0)
    const isSolid = (tx: number, ty: number) => tx === 1 && ty === 0;
    const initialPos = vec2(0.8, 0.5); // inside the 0.3 radius from tile edge at x=1
    const resolved = resolveCircleTileCollision(initialPos, 0.3, isSolid);
    expect(resolved.x).toBeLessThanOrEqual(0.7001);
  });
});

describe("Voxel Models", () => {
  it("has valid built-in models with palettes and voxels", () => {
    const player = BUILTIN_VOXEL_MODELS.player;
    expect(player).toBeDefined();
    expect(player.size).toEqual([8, 12, 8]);
    expect(player.palette.length).toBeGreaterThan(4);
    // Ensure voxels array has correct length
    expect(player.voxels.length).toBe(8 * 12 * 8);

    // Ensure non-zero voxels exist (e.g. robe)
    const midVoxel = getVoxel(player, 3, 3, 3);
    expect(midVoxel).toBeGreaterThan(0);
  });
});

describe("Static Maps & Tiles", () => {
  it("exports TileType, WallType and computes tile solidity accurately in tiles.ts", () => {
    const miniMap = {
      width: 3,
      height: 3,
      ground: [
        TileType.VOID,
        TileType.GRASS,
        TileType.NEXUS_MARBLE,
        TileType.GRASS,
        TileType.GRASS,
        TileType.GRASS,
        TileType.GRASS,
        TileType.GRASS,
        TileType.GRASS,
      ],
      walls: [
        WallType.NONE,
        WallType.NONE,
        WallType.NONE,
        WallType.NONE,
        WallType.STONE_WALL,
        WallType.NONE,
        WallType.NONE,
        WallType.NONE,
        WallType.TREE,
      ],
    };

    // Out of bounds is solid
    expect(isSolidTileDirect(miniMap, -1, 0)).toBe(true);
    expect(isSolidTileDirect(miniMap, 3, 0)).toBe(true);
    expect(isSolidTileDirect(miniMap, 0, -1)).toBe(true);
    expect(isSolidTileDirect(miniMap, 0, 3)).toBe(true);

    // Void ground is solid
    expect(isSolidTileDirect(miniMap, 0, 0)).toBe(true);

    // Normal walkable ground with no wall is not solid
    expect(isSolidTileDirect(miniMap, 1, 0)).toBe(false);
    expect(isSolidTileDirect(miniMap, 2, 0)).toBe(false);

    // Stone wall and tree are solid
    expect(isSolidTileDirect(miniMap, 1, 1)).toBe(true);
    expect(isSolidTileDirect(miniMap, 2, 2)).toBe(true);
  });

  it("initializes static maps with valid bounds, entities, and spawn points", () => {
    const nexus = ZONES.nexus.createMap();
    expect(nexus.width).toBe(40);
    expect(nexus.height).toBe(40);
    expect(nexus.entities.length).toBeGreaterThan(0);
    expect(nexus.entities[0].prefabId).toBe("portal_realm");

    // Spawn point must be walkable
    expect(
      isSolidTile(
        nexus,
        Math.floor(nexus.spawnPoint.x),
        Math.floor(nexus.spawnPoint.y),
      ),
    ).toBe(false);

    // Outer wall must be solid
    expect(isSolidTile(nexus, 0, 0)).toBe(true);

    // Verify all zone maps have valid prefabs configured
    for (const zone of Object.values(ZONES)) {
      const map = zone.createMap();
      expect(map.id).toBeDefined();
      expect(map.entities.length).toBeGreaterThan(0);
      for (const ent of map.entities) {
        expect(getPrefab(ent.prefabId)).toBeDefined();
      }
    }
  });
});

describe("Zones", () => {
  it("keys every zone by its own id and builds a map with the same id", () => {
    for (const [key, zone] of Object.entries(ZONES)) {
      expect(zone.id).toBe(key);
      expect(zone.createMap().id).toBe(zone.id);
    }
  });

  it("points every portal at an existing zone", () => {
    const targets: string[] = [];
    for (const zone of Object.values(ZONES)) {
      for (const ent of zone.createMap().entities) {
        const prefabTarget = (getPrefab(ent.prefabId) as any)?.components
          ?.Portal?.targetZoneId;
        const overrideTarget = (ent.overrides as any)?.Portal?.targetZoneId;
        const target = overrideTarget ?? prefabTarget;
        if (target !== undefined) targets.push(target);
      }
    }
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !isZoneId(t))).toEqual([]);
  });

  it("gives sharded zones a soft cap below the hard cap", () => {
    for (const zone of Object.values(ZONES)) {
      if (zone.access.kind === "public_sharded") {
        expect(zone.access.softCap).toBeLessThanOrEqual(zone.access.hardCap);
      }
    }
  });
});

describe("Declarative Entity Prefabs & AI State Machines", () => {
  it("defines component-composed enemy prefabs with movement and declarative AI", () => {
    const slime = getPrefab<MonsterPrefab>("slime")!;
    expect(slime).toBeDefined();
    expect(slime.components.Model?.scale).toBe(0.8);
    expect(slime.components.Animation?.type).toBe("squash_and_stretch");
    expect(slime.components.Speed?.value).toBe(2.0);
    expect(slime.components.Health?.max).toBe(60);
    expect(slime.components.AI?.phases?.length).toBe(1);
    expect(slime.components.AI?.phases?.[0].movement?.type).toBe("chase");
    expect(slime.components.AI?.phases?.[0].attacks?.length).toBe(1);
    expect(slime.components.AI?.phases?.[0].attacks?.[0].type).toBe(
      "single_shot",
    );

    const pirate = getPrefab<MonsterPrefab>("pirate")!;
    expect(pirate).toBeDefined();
    expect(pirate.components.Speed?.value).toBe(2.4);
    expect(pirate.components.Health?.max).toBe(140);
    expect(pirate.components.AI?.phases?.[0].movement?.type).toBe("chase");
    expect(pirate.components.AI?.phases?.[0].attacks?.[0].type).toBe("shotgun");
    if (pirate.components.AI?.phases?.[0].attacks?.[0].type === "shotgun") {
      expect(pirate.components.AI?.phases?.[0].attacks?.[0].bulletCount).toBe(
        3,
      );
    }

    const golem = getPrefab<MonsterPrefab>("golem_boss")!;
    expect(golem).toBeDefined();
    expect(golem.components.Model?.scale).toBe(2.4);
    expect(golem.components.Health?.max).toBe(1200);
    expect(golem.components.AI?.phases?.length).toBe(2);
  });

  it("configures multi-phase state machines on boss prefabs with enrage triggers", () => {
    const golem = getPrefab<MonsterPrefab>("golem_boss")!;
    expect(golem).toBeDefined();
    expect(golem.components.Model?.scale).toBe(2.4);
    expect(golem.components.Health?.max).toBe(1200);
    expect(golem.components.AI?.phases?.length).toBe(2);

    // Phase 1: Guarding (100% to 50% HP)
    const phase1 = golem.components.AI?.phases?.[0]!;
    expect(phase1.name).toBe("Guarding");
    expect(phase1.movement?.type).toBe("stand");
    expect(phase1.attacks?.length).toBe(1);
    expect(phase1.attacks?.[0].type).toBe("shotgun");

    // Phase 2: Enraged (<= 50% HP)
    const phase2 = golem.components.AI?.phases?.[1]!;
    expect(phase2.name).toBe("Enraged");
    expect(phase2.triggerOnHpPercent).toBe(0.5);
    expect(phase2.speedMultiplier).toBe(1.8);
    expect(phase2.movement?.type).toBe("chase");
    expect(phase2.attacks?.length).toBe(2);
    expect(phase2.attacks?.[0].type).toBe("shotgun");
    expect(phase2.attacks?.[1].type).toBe("radial_nova");
    if (phase2.attacks?.[1].type === "radial_nova") {
      expect(phase2.attacks[1].bulletCount).toBe(16);
    }
  });
});

describe("Item System & 2D Thumbnail Projection", () => {
  it("registers valid weapon and armor definitions", () => {
    const energyStaff = getItemDefinition("staff_energy");
    expect(energyStaff).toBeDefined();
    expect(energyStaff!.type).toBe("weapon");
    expect(energyStaff!.rarity).toBe("common");
    if (energyStaff && energyStaff.type === "weapon") {
      expect(energyStaff.damage).toBe(32);
      expect(energyStaff.projectileCount).toBe(1);
    }

    const fireStaff = getItemDefinition("staff_fire");
    expect(fireStaff).toBeDefined();
    expect(fireStaff?.type).toBe("weapon");
    expect(fireStaff?.rarity).toBe("uncommon");
    if (fireStaff && fireStaff.type === "weapon") {
      expect(fireStaff.damage).toBe(28);
      expect(fireStaff.projectileCount).toBe(2);
      expect(fireStaff.pattern).toBe("spread");
    }

    const appRobe = getItemDefinition("robe_apprentice");
    expect(appRobe).toBeDefined();
    expect(appRobe?.type).toBe("armor");
    expect(appRobe?.rarity).toBe("common");
    if (appRobe && appRobe.type === "armor") {
      expect(appRobe.defense).toBe(3);
    }

    const magRobe = getItemDefinition("robe_magician");
    expect(magRobe).toBeDefined();
    expect(magRobe?.type).toBe("armor");
    expect(magRobe?.rarity).toBe("uncommon");
    if (magRobe && magRobe.type === "armor") {
      expect(magRobe.defense).toBe(6);
      expect(magRobe.maxMpBonus).toBe(20);
    }
  });

  it("projects 3D voxel models into 2D SVG thumbnails and data URLs", () => {
    const fireStaffModel = BUILTIN_VOXEL_MODELS["staff_fire"];
    expect(fireStaffModel).toBeDefined();

    const svg = voxelModelToSvg(fireStaffModel, { size: 32 });
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect(svg).toContain("<rect");

    const dataUrl = voxelModelToDataUrl(fireStaffModel);
    expect(dataUrl.startsWith("data:image/svg+xml;utf8,")).toBe(true);
  });

  it("configures loot tables on monster prefabs", () => {
    const slime = getPrefab<MonsterPrefab>("slime");
    expect(slime).toBeDefined();
    expect(slime!.components.DropTable).toBeDefined();
    expect(slime!.components.DropTable!.drops!.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      slime!.components.DropTable!.drops!.some(
        (d: any) => d.itemId === "robe_apprentice",
      ),
    ).toBe(true);

    const pirate = getPrefab<MonsterPrefab>("pirate");
    expect(pirate).toBeDefined();
    expect(pirate!.components.DropTable).toBeDefined();
    expect(
      pirate!.components.DropTable!.drops!.some(
        (d: any) => d.itemId === "sword_iron",
      ),
    ).toBe(true);

    const golem = getPrefab<MonsterPrefab>("golem_boss");
    expect(golem).toBeDefined();
    expect(golem!.components.DropTable).toBeDefined();
    expect(
      golem!.components.DropTable!.drops!.find(
        (d: any) => d.itemId === "staff_fire",
      )?.chance,
    ).toBe(0.5);
    expect(
      golem!.components.DropTable!.drops!.find(
        (d: any) => d.itemId === "sword_iron",
      )?.chance,
    ).toBe(0.5);
  });
});

describe("Combat System & Damage Calculations", () => {
  it("calculates damage with defense subtraction and 15% chip damage floor", () => {
    // 100 raw damage vs 0 DEF -> 100
    expect(calculateDamage(100, 0)).toBe(100);
    // 100 raw damage vs 30 DEF -> 70
    expect(calculateDamage(100, 30)).toBe(70);
    // 100 raw damage vs 120 DEF -> min chip damage floor (floor(100 * 0.15) = 15)
    expect(calculateDamage(100, 120)).toBe(15);
    // 20 raw damage vs 25 DEF -> floor(20 * 0.15) = 3
    expect(calculateDamage(20, 25)).toBe(3);
  });

  it("applies damage cleanly to target entity", () => {
    const monster = { hp: 50, defense: 10 };
    const res = applyDamage(monster, 25);
    // 25 - 10 = 15 damage
    expect(res.damageDealt).toBe(15);
    expect(res.currentHp).toBe(35);
    expect(res.isFatal).toBe(false);

    // Fatal hit
    const resFatal = applyDamage(monster, 100);
    expect(resFatal.currentHp).toBe(0);
    expect(resFatal.isFatal).toBe(true);
  });

  it("creates weapon projectiles with single and spread cones", () => {
    const energyStaff = getItemDefinition("staff_energy");
    expect(energyStaff?.type).toBe("weapon");
    if (energyStaff && energyStaff.type === "weapon") {
      const cooldown = getWeaponAttackCooldown(energyStaff);
      expect(cooldown).toBeCloseTo(1 / 3.5);

      const bullets = createWeaponProjectiles({
        ownerId: "player1",
        startX: 10,
        startY: 10,
        baseAngle: 0,
        weapon: energyStaff,
      });
      expect(bullets.length).toBe(1);
      expect(bullets[0].damage).toBe(32);
      expect(bullets[0].color).toBe("#06b6d4");
      expect(bullets[0].angle).toBe(0);
    }

    const fireStaff = getItemDefinition("staff_fire");
    expect(fireStaff?.type).toBe("weapon");
    if (fireStaff && fireStaff.type === "weapon") {
      const bullets = createWeaponProjectiles({
        ownerId: "player1",
        startX: 10,
        startY: 10,
        baseAngle: Math.PI / 2,
        weapon: fireStaff,
      });
      expect(bullets.length).toBe(2);
      expect(bullets[0].damage).toBe(28);
      // Verify spread angle separation
      const angleDiff = Math.abs(bullets[1].angle - bullets[0].angle);
      expect(angleDiff).toBeCloseTo(0.12);
    }
  });
});

describe("Player Progression & Class Archetypes", () => {
  it("initializes Wizard with baseline stats and equipment", () => {
    const wizard = createDefaultCharacter("Merlin", "wizard", "wiz1");

    expect(wizard.name).toBe("Merlin");
    expect(wizard.classId).toBe("wizard");
    expect(wizard.level).toBe(1);
    expect(wizard.equipment.weapon).toBe("staff_energy");
    expect(wizard.equipment.armor).toBe("robe_apprentice");
    expect(wizard.inventory.length).toBe(8);

    // Effective stats: Base 100 HP + 10 (robe) = 110 HP, Base 0 DEF + 3 (robe) = 3 DEF
    const baseStats = computeBaseStatsForLevel("wizard", 1);
    const stats = computeEffectiveStats(baseStats, wizard.equipment);
    expect(stats.maxHp).toBe(110);
    expect(stats.defense).toBe(3);
    expect(stats.speed).toBe(5.5);
  });

  it("initializes Knight with high HP, baseline defense, and sword/armor", () => {
    const knight = createDefaultCharacter("Arthur", "knight", "knt1");

    expect(knight.name).toBe("Arthur");
    expect(knight.classId).toBe("knight");
    expect(knight.equipment.weapon).toBe("sword_iron");
    expect(knight.equipment.armor).toBe("armor_iron");

    // Effective stats: Base 150 HP + 25 (iron armor) = 175 HP, Base 4 DEF + 8 (iron armor) = 12 DEF
    const baseStats = computeBaseStatsForLevel("knight", 1);
    const stats = computeEffectiveStats(baseStats, knight.equipment);
    expect(stats.maxHp).toBe(175);
    expect(stats.defense).toBe(12);
    expect(stats.speed).toBe(4.8);
  });

  it("progresses stats distinctly on level-up for Wizard vs Knight", () => {
    // Wizard level 2 stats
    const wizBaseLvl2 = computeBaseStatsForLevel("wizard", 2);
    const wizStats = computeEffectiveStats(wizBaseLvl2, {
      weapon: "staff_energy",
      armor: "robe_apprentice",
    });
    // Wizard base: 100 + 18 = 118 base HP (+10 from robe = 128 effective HP)
    // Wizard base MP: 80 + 25 = 105 base MP
    // Wizard DEF: 0 + 0.5 = 0.5 (+3 from robe = 3.5 effective DEF)
    expect(wizStats.maxHp).toBe(128);
    expect(wizStats.maxMp).toBe(105);
    expect(wizStats.defense).toBe(3.5);

    // Knight level 2 stats
    const kntBaseLvl2 = computeBaseStatsForLevel("knight", 2);
    const kntStats = computeEffectiveStats(kntBaseLvl2, {
      weapon: "sword_iron",
      armor: "armor_iron",
    });
    // Knight base: 150 + 25 = 175 base HP (+25 from armor = 200 effective HP)
    // Knight base MP: 40 + 10 = 50 base MP
    // Knight DEF: 4 + 1.5 = 5.5 base DEF (+8 from armor = 13.5 effective DEF)
    expect(kntStats.maxHp).toBe(200);
    expect(kntStats.maxMp).toBe(50);
    expect(kntStats.defense).toBe(13.5);
  });

  it("adds experience and calculates level thresholds", () => {
    const xpNeededLvl1 = getXpForNextLevel(1);
    expect(xpNeededLvl1).toBe(100);

    const xpNeededLvl2 = getXpForNextLevel(2);
    expect(xpNeededLvl2).toBeGreaterThan(100);
  });

  it("enforces class equipment compatibility rules", () => {
    // Wizard cannot equip heavy sword
    const wizSwordCheck = canEquipItem("wizard", "sword_iron", "weapon");
    expect(wizSwordCheck.canEquip).toBe(false);

    // Wizard can equip fire staff
    const wizStaffCheck = canEquipItem("wizard", "staff_fire", "weapon");
    expect(wizStaffCheck.canEquip).toBe(true);

    // Knight cannot equip wizard robe
    const kntRobeCheck = canEquipItem("knight", "robe_apprentice", "armor");
    expect(kntRobeCheck.canEquip).toBe(false);

    // Knight can equip iron sword
    const kntSwordCheck = canEquipItem("knight", "sword_iron", "weapon");
    expect(kntSwordCheck.canEquip).toBe(true);
  });
});

describe("Projectile Prefabs & Voxel Models", () => {
  it("registers square and rectangular projectile prefabs", () => {
    expect(PREFABS.projectile_square).toBeDefined();
    expect(PREFABS.projectile_rectangular).toBeDefined();

    const square = getPrefab<ProjectilePrefab>("projectile_square")!;
    expect(square.id).toBe("projectile_square");
    expect(square.components.Projectile?.shape).toBe("square");
    expect(square.components.Projectile?.color).toBe("#38bdf8");
    expect(square.components.Model?.tint).toBe("#38bdf8");

    const rectangular = getPrefab<ProjectilePrefab>("projectile_rectangular")!;
    expect(rectangular.id).toBe("projectile_rectangular");
    expect(rectangular.components.Projectile?.shape).toBe("rectangular");
    expect(rectangular.components.Projectile?.color).toBe("#f59e0b");
    expect(rectangular.components.Model?.tint).toBe("#f59e0b");
  });

  it("registers built-in voxel models for projectiles", () => {
    expect(BUILTIN_VOXEL_MODELS.projectile_square).toBeDefined();
    expect(BUILTIN_VOXEL_MODELS.projectile_rectangular).toBeDefined();
    expect(BUILTIN_VOXEL_MODELS.projectile_square.size).toEqual([3, 3, 3]);
    expect(BUILTIN_VOXEL_MODELS.projectile_rectangular.size).toEqual([2, 2, 6]);
  });
});

describe("Universal Component & Prefab Composition System", () => {
  it("composes character class prefabs with visual, physics, and progression components", () => {
    const wizard = getPrefab<CharacterClassPrefab>("wizard")!;
    expect(wizard).toBeDefined();
    expect(wizard.category).toBe("character");
    expect(wizard.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(wizard.components.Velocity).toEqual({ vx: 0, vy: 0 });
    expect(wizard.components.InputQueue).toBeDefined();
    expect(wizard.components.Shooter).toBeDefined();
    expect(wizard.components.Model).toBeDefined();
    expect(wizard.components.Model?.modelId).toBe("player");
    expect(wizard.components.Model?.scale).toBe(1.2);
    expect(wizard.components.Collider).toBeDefined();
    expect(wizard.components.Collider?.radius).toBe(0.35);
    expect(wizard.components.Collider?.layer).toBe("player");
    expect(wizard.components.Progression).toBeDefined();
    expect(wizard.components.Progression?.classData?.baseStats.maxHp).toBe(100);

    const knight = getPrefab<CharacterClassPrefab>("knight")!;
    expect(knight).toBeDefined();
    expect(knight.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(knight.components.Velocity).toEqual({ vx: 0, vy: 0 });
    expect(knight.components.InputQueue).toBeDefined();
    expect(knight.components.Shooter).toBeDefined();
    expect(knight.components.Model?.modelId).toBe("knight");
    expect(knight.components.Collider?.radius).toBe(0.35);
    expect(knight.components.Progression?.classData?.baseStats.defense).toBe(4);
  });

  it("composes monster prefabs with visual, physics, stats, movement, and ai components", () => {
    const slime = getPrefab<MonsterPrefab>("slime")!;
    expect(slime).toBeDefined();
    expect(slime.category).toBe("enemy");
    expect(slime.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(slime.components.Velocity).toEqual({ vx: 0, vy: 0 });
    expect(slime.components.Model?.modelId).toBe("slime");
    expect(slime.components.Animation?.type).toBe("squash_and_stretch");
    expect(slime.components.Collider?.radius).toBe(0.4);
    expect(slime.components.Health?.max).toBe(60);
    expect(slime.components.Speed?.value).toBeGreaterThan(0);
    expect(slime.components.AI?.phases?.length).toBeGreaterThan(0);
    expect(slime.components.AI?.originX).toBe(0);
  });

  it("composes projectile prefabs with visual, physics, and projectile motion components", () => {
    const projRect = getPrefab<ProjectilePrefab>("projectile_rectangular")!;
    expect(projRect).toBeDefined();
    expect(projRect.category).toBe("projectile");
    expect(projRect.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(projRect.components.Velocity).toEqual({ vx: 0, vy: 0 });
    expect(projRect.components.Model?.modelId).toBe("projectile_rectangular");
    expect(projRect.components.Projectile?.shape).toBe("rectangular");
    expect(projRect.components.Projectile?.speed).toBe(14.0);
    expect(projRect.components.Projectile?.startX).toBe(0);
  });

  it("composes environment prefabs (portals and loot bags) with procedural animations and trigger colliders", () => {
    const nexusPortal = getPrefab<PortalPrefab>("portal_nexus");
    expect(nexusPortal).toBeDefined();
    expect(nexusPortal!.category).toBe("portal");
    expect(nexusPortal!.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(nexusPortal!.components.Model?.scale).toBe(1.8);
    expect(nexusPortal!.components.Animation?.type).toBe("float");
    expect(nexusPortal!.components.Collider?.isTrigger).toBe(true);

    const brownBag = getPrefab<LootBagPrefab>("bag_brown");
    expect(brownBag).toBeDefined();
    expect(brownBag!.category).toBe("loot_bag");
    expect(brownBag!.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(brownBag!.components.Model?.scale).toBe(0.6);
    expect(brownBag!.components.Animation?.type).toBe("bob");
    expect(brownBag!.components.Collider?.isTrigger).toBe(true);
    expect(brownBag!.components.LootBag?.maxLifetimeMs).toBe(60000);
  });

  it("composes spawner prefab with position, identity, and spawner config", () => {
    const spawner = getPrefab("spawner");
    expect(spawner).toBeDefined();
    expect(spawner!.category).toBe("spawner");
    expect(spawner!.components.Position).toEqual({ x: 0, y: 0, angle: 0 });
    expect(spawner!.components.Identity?.prefabId).toBe("spawner");
    expect(spawner!.components.Spawner?.spawnRadius).toBe(3.0);
  });

  it("registers all prefabs across categories in the universal PREFABS registry", () => {
    expect(PREFABS.wizard).toBeDefined();
    expect(PREFABS.knight).toBeDefined();
    expect(PREFABS.slime).toBeDefined();
    expect(PREFABS.pirate).toBeDefined();
    expect(PREFABS.golem_boss).toBeDefined();
    expect(PREFABS.projectile_square).toBeDefined();
    expect(PREFABS.projectile_rectangular).toBeDefined();
    expect(PREFABS.portal_nexus).toBeDefined();
    expect(PREFABS.bag_brown).toBeDefined();
    expect(PREFABS.spawner).toBeDefined();
  });

  it("throws an error when looking up an unknown class definition instead of silent fallback", () => {
    expect(() => {
      getClassDefinition("non_existent_class");
    }).toThrow("Unknown character class: non_existent_class");
  });
});
