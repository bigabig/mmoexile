import type {
  CharacterBaseStats,
  PlayerEquipment,
  EffectivePlayerStats,
} from "../components/index.js";
import { getItemDefinition } from "../items/index.js";
import type { ArmorItemDefinition } from "../items/types.js";
import { getClassDefinition } from "./character.js";

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

