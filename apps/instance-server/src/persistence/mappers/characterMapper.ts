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
  currentWorld: string;
  isAlive: boolean;
  deathReason?: string;
  equippedWeapon?: string | null;
  equippedArmor?: string | null;
  inventory?: string | (string | null)[];
}

export class CharacterMapper {
  /**
   * Converts a database Character record into a CharacterData struct.
   */
  public static toDomain(
    record: PrismaCharacter,
    nickname?: string,
  ): CharacterData {
    let inventory: (string | null)[];
    try {
      inventory = JSON.parse(record.inventory);
      if (!Array.isArray(inventory) || inventory.length !== 8) {
        inventory = new Array(8).fill(null);
      }
    } catch {
      inventory = new Array(8).fill(null);
    }

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
    currentWorld: string = "nexus",
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
      inventory: JSON.stringify(domainChar.inventory),
      currentWorld,
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
  ): Prisma.CharacterUpdateInput {
    let serializedInventory: string | undefined = undefined;
    if (state.inventory !== undefined) {
      serializedInventory =
        typeof state.inventory === "string"
          ? state.inventory
          : JSON.stringify(state.inventory);
    }

    return {
      hp: state.hp,
      mp: state.mp !== undefined ? state.mp : undefined,
      level: state.level !== undefined ? state.level : undefined,
      xp: state.xp !== undefined ? state.xp : undefined,
      x: state.x,
      y: state.y,
      currentWorld: state.currentWorld,
      isAlive: state.isAlive,
      deathReason: state.deathReason,
      equippedWeapon:
        state.equippedWeapon !== undefined ? state.equippedWeapon : undefined,
      equippedArmor:
        state.equippedArmor !== undefined ? state.equippedArmor : undefined,
      inventory: serializedInventory,
    };
  }
}
