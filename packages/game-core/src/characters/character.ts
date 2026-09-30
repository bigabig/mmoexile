import type { CharacterClassPrefab } from "../prefabs/types.js";
import { getPrefab } from "../prefabs/catalog.js";
import { computeEffectiveStats } from "./formulas.js";

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
