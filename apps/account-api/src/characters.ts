import type { Character, Prisma } from "@mmoexile/db";
import {
  computeBaseStatsForLevel,
  computeEffectiveStats,
  createDefaultCharacter,
} from "@mmoexile/game-core";
import type { CharacterSummary } from "@mmoexile/contracts";

/** The public view of a character row. */
export function toSummary(character: Character): CharacterSummary {
  return {
    id: character.id,
    classId: character.class as CharacterSummary["classId"],
    level: character.level,
    xp: character.xp,
    isAlive: character.isAlive,
    lastZoneId: character.lastZoneId,
    createdAt: character.createdAt.toISOString(),
  };
}

/** A fresh level 1 character with the class's default equipment and stats. */
export function newCharacterData(
  accountId: string,
  nickname: string,
  classId: string,
): Prisma.CharacterUncheckedCreateInput {
  const character = createDefaultCharacter(nickname, classId);
  const stats = computeEffectiveStats(
    computeBaseStatsForLevel(classId, 1),
    character.equipment,
  );
  return {
    accountId,
    class: classId,
    level: 1,
    xp: 0,
    hp: character.hp,
    maxHp: stats.maxHp,
    mp: character.mp,
    maxMp: stats.maxMp,
    defense: stats.defense,
    speed: stats.speed,
    attack: stats.attack,
    dexterity: stats.dexterity,
    equippedWeapon: character.equipment.weapon,
    equippedArmor: character.equipment.armor,
    inventory: character.inventory,
    lastZoneId: "nexus",
  };
}
