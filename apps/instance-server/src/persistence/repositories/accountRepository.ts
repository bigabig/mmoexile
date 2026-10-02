import { Account, Character } from "@mmoexile/db";
import { prisma } from "@mmoexile/db";
import { hashSecret } from "@mmoexile/auth";

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
   * Finds an account by the client's token (its refresh secret), including its
   * active character. Only the hash of the token is stored.
   */
  async findByToken(
    token: string,
  ): Promise<(Account & { characters: Character[] }) | null> {
    return prisma.account.findUnique({
      where: { refreshSecretHash: hashSecret(token) },
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
        refreshSecretHash: hashSecret(data.token),
      },
    });
  }
}

export const accountRepo = new AccountRepository();

