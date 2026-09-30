import { getItemDefinition } from "../items/index.js";
import type {
  WeaponItemDefinition,
  ArmorItemDefinition,
} from "../items/types.js";
import type {
  CharacterBaseStats,
  PlayerEquipment,
  EffectivePlayerStats,
} from "../components/index.js";
import type { CharacterClassPrefab } from "../prefabs/types.js";
import { getPrefab } from "../prefabs/catalog.js";

export interface CharacterData {
  id: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  equipment: {
    weapon: string | null;
    armor: string | null;
  };
  inventory: (string | null)[];
}

/**
 * Retrieves the archetype prefab for a character class.
 */
export function getClassDefinition(classId: string): CharacterClassPrefab {
  const classDef = getPrefab<CharacterClassPrefab>(classId);
  if (!classDef) {
    throw new Error(`Unknown character class: ${classId}`);
  }
  return classDef;
}

/**
 * Creates a default character data struct for a new player.
 */
export function createDefaultCharacter(
  name: string,
  classId: string = "wizard",
  id: string = "temp",
): CharacterData {
  const classDef = getClassDefinition(classId);
  const classData = classDef.components.Progression?.classData!;
  const base = classData.baseStats;
  const eq = {
    weapon:
      classDef.components.Equipment?.weapon ??
      classData.defaultEquipment.weapon,
    armor:
      classDef.components.Equipment?.armor ?? classData.defaultEquipment.armor,
  };
  const effective = computeEffectiveStats(base, eq);

  return {
    id,
    name,
    classId: classDef.id,
    level: 1,
    xp: 0,
    hp: effective.maxHp,
    mp: effective.maxMp,
    equipment: eq,
    inventory: new Array(8).fill(null),
  };
}

/**
 * Computes base stats for a given level using class stat gains.
 */
export function computeBaseStatsForLevel(
  classId: string,
  level: number,
): CharacterBaseStats {
  const classDef = getClassDefinition(classId);
  const classData = classDef.components.Progression?.classData!;
  const base = classData.baseStats;
  const gains = classData.statGainsPerLevel;
  const lvlOffset = Math.max(0, level - 1);

  return {
    maxHp: base.maxHp + gains.maxHp * lvlOffset,
    maxMp: base.maxMp + gains.maxMp * lvlOffset,
    defense: base.defense + gains.defense * lvlOffset,
    speed: base.speed + gains.speed * lvlOffset,
    attack: base.attack + gains.attack * lvlOffset,
    dexterity: base.dexterity + gains.dexterity * lvlOffset,
  };
}

/**
 * Computes effective stats by combining base stats with equipped armor/weapon bonuses.
 */
export function computeEffectiveStats(
  baseStats: CharacterBaseStats,
  equipment: PlayerEquipment,
): EffectivePlayerStats {
  let maxHp = baseStats.maxHp;
  let maxMp = baseStats.maxMp;
  let defense = baseStats.defense;
  const speed = baseStats.speed;
  const attack = baseStats.attack;
  const dexterity = baseStats.dexterity;

  // Apply equipped armor bonuses
  if (equipment.armor) {
    const armorDef = getItemDefinition(equipment.armor) as
      | ArmorItemDefinition
      | undefined;
    if (armorDef && armorDef.type === "armor") {
      defense += armorDef.defense || 0;
      maxHp += armorDef.maxHpBonus || 0;
      maxMp += armorDef.maxMpBonus || 0;
    }
  }

  return {
    maxHp: Math.round(maxHp),
    maxMp: Math.round(maxMp),
    defense: Math.round(defense * 10) / 10,
    speed: Math.round(speed * 100) / 100,
    attack: Math.round(attack * 10) / 10,
    dexterity: Math.round(dexterity * 10) / 10,
  };
}

/**
 * Returns XP required to reach the next level from the current level.
 */
export function getXpForNextLevel(currentLevel: number): number {
  return Math.floor(100 * Math.pow(currentLevel, 1.35));
}

/**
 * Checks if an item can be equipped by a character class.
 */
export function canEquipItem(
  classId: string,
  itemId: string,
  slot?: "weapon" | "armor",
): { canEquip: boolean; reason?: string; targetSlot?: "weapon" | "armor" } {
  const itemDef = getItemDefinition(itemId);
  if (!itemDef) {
    return { canEquip: false, reason: "Item does not exist" };
  }

  const classDef = getClassDefinition(classId);
  const classData = classDef.components.Progression?.classData!;

  if (itemDef.type === "weapon") {
    if (slot && slot !== "weapon") {
      return { canEquip: false, reason: "Cannot equip weapon in armor slot" };
    }
    const weaponDef = itemDef as WeaponItemDefinition;
    if (
      weaponDef.weaponSubtype &&
      !classData.allowedWeaponSubtypes.includes(weaponDef.weaponSubtype)
    ) {
      return {
        canEquip: false,
        reason: `${classDef.name} cannot equip ${weaponDef.weaponSubtype} weapons`,
      };
    }
    return { canEquip: true, targetSlot: "weapon" };
  }

  if (itemDef.type === "armor") {
    if (slot && slot !== "armor") {
      return { canEquip: false, reason: "Cannot equip armor in weapon slot" };
    }
    const armorDef = itemDef as ArmorItemDefinition;
    if (
      armorDef.armorSubtype &&
      !classData.allowedArmorSubtypes.includes(armorDef.armorSubtype)
    ) {
      return {
        canEquip: false,
        reason: `${classDef.name} cannot equip ${armorDef.armorSubtype} armor`,
      };
    }
    return { canEquip: true, targetSlot: "armor" };
  }

  return { canEquip: false, reason: "Item is not equippable" };
}
