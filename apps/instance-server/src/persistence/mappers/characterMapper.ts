import { Character as PrismaCharacter, Prisma } from "@mmoexile/db";
import {
  CharacterData,
  computeEffectiveStats,
  computeBaseStatsForLevel,
} from "@mmoexile/game-core";

export interface CharacterUpdateState {
  hp: number;
  mp?: number;
  level?: number;
  xp?: number;
  x: number;
  y: number;
  /** Zone (not instance) the character is in. */
  lastZoneId: string;
  isAlive: boolean;
  deathReason?: string;
  equippedWeapon?: string | null;
  equippedArmor?: string | null;
  inventory?: (string | null)[];
}

const INVENTORY_SIZE = 8;

/** Reads the Json inventory column, tolerating malformed data. */
function parseInventory(value: unknown): (string | null)[] {
  if (
    Array.isArray(value) &&
    value.length === INVENTORY_SIZE &&
    value.every((slot) => slot === null || typeof slot === "string")
  ) {
    return value as (string | null)[];
  }
  return new Array(INVENTORY_SIZE).fill(null);
}

export class CharacterMapper {
  /**
   * Converts a database Character record into a CharacterData struct.
   */
  public static toDomain(
    record: PrismaCharacter,
    nickname?: string,
  ): CharacterData {
    const inventory = parseInventory(record.inventory);

    return {
      id: record.id,
      name: nickname || "Hero",
      classId: record.class,
      level: record.level,
      xp: record.xp,
      hp: record.hp,
      mp: record.mp,
      equipment: {
        weapon: record.equippedWeapon,
        armor: record.equippedArmor,
      },
      inventory,
    };
  }

  /**
   * Converts a CharacterData model into a Prisma Character creation input.
   */
  public static toPersistenceCreate(
    domainChar: CharacterData,
    accountId: string,
    lastZoneId: string = "nexus",
    x: number = 20.0,
    y: number = 20.0,
  ): Prisma.CharacterUncheckedCreateInput {
    const base = computeBaseStatsForLevel(domainChar.classId, domainChar.level);
    const effective = computeEffectiveStats(base, domainChar.equipment);

    return {
      accountId,
      class: domainChar.classId,
      level: domainChar.level,
      xp: domainChar.xp,
      hp: domainChar.hp,
      maxHp: effective.maxHp,
      mp: domainChar.mp,
      maxMp: effective.maxMp,
      defense: effective.defense,
      speed: effective.speed,
      attack: effective.attack,
      dexterity: effective.dexterity,
      equippedWeapon: domainChar.equipment.weapon,
      equippedArmor: domainChar.equipment.armor,
      inventory: domainChar.inventory,
      lastZoneId,
      x,
      y,
      isAlive: true,
    };
  }

  /**
   * Converts an ad-hoc game update payload into a Prisma Character update input.
   */
  public static toPersistenceUpdate(
    state: CharacterUpdateState,
  ): Prisma.CharacterUpdateManyMutationInput {
    return {
      hp: state.hp,
      mp: state.mp !== undefined ? state.mp : undefined,
      level: state.level !== undefined ? state.level : undefined,
      xp: state.xp !== undefined ? state.xp : undefined,
      x: state.x,
      y: state.y,
      lastZoneId: state.lastZoneId,
      isAlive: state.isAlive,
      deathReason: state.deathReason,
      equippedWeapon:
        state.equippedWeapon !== undefined ? state.equippedWeapon : undefined,
      equippedArmor:
        state.equippedArmor !== undefined ? state.equippedArmor : undefined,
      inventory: state.inventory,
    };
  }
}
