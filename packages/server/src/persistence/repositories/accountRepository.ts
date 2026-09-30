import { Account, Character } from "@prisma/client";
import { prisma } from "../connection.js";

export class AccountRepository {
  /**
   * Finds an account by primary key ID.
   */
  async findById(id: string): Promise<Account | null> {
    return prisma.account.findUnique({
      where: { id },
    });
  }

  /**
   * Finds an account by auth token, including its active characters ordered by most recent.
   */
  async findByToken(
    token: string,
  ): Promise<(Account & { characters: Character[] }) | null> {
    return prisma.account.findUnique({
      where: { token },
      include: {
        characters: {
          where: { isAlive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  /**
   * Creates a new account.
   */
  async createAccount(data: {
    nickname: string;
    token: string;
  }): Promise<Account> {
    return prisma.account.create({
      data: {
        nickname: data.nickname,
        token: data.token,
      },
    });
  }
}

export const accountRepo = new AccountRepository();

