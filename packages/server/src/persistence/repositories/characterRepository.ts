import { Character, Prisma } from "@prisma/client";
import { prisma } from "../connection.js";

export class CharacterRepository {
  /**
   * Finds a character by its primary key ID.
   */
  async findById(id: string): Promise<Character | null> {
    return prisma.character.findUnique({
      where: { id },
    });
  }

  /**
   * Finds the currently active (isAlive=true) character for an account.
   */
  async findActiveByAccountId(accountId: string): Promise<Character | null> {
    return prisma.character.findFirst({
      where: {
        accountId,
        isAlive: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Inserts a new character row.
   */
  async create(data: Prisma.CharacterUncheckedCreateInput): Promise<Character> {
    return prisma.character.create({
      data,
    });
  }

  /**
   * Updates state attributes on an existing character.
   */
  async updateState(
    id: string,
    data: Prisma.CharacterUpdateInput,
  ): Promise<Character> {
    return prisma.character.update({
      where: { id },
      data,
    });
  }

  /**
   * Marks a character dead and records the cause of death.
   */
  async markDead(id: string, deathReason?: string): Promise<Character> {
    return prisma.character.update({
      where: { id },
      data: {
        isAlive: false,
        deathReason: deathReason || "Slain in the realm",
      },
    });
  }
}

export const characterRepo = new CharacterRepository();
