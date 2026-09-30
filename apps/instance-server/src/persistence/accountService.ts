import { randomUUID } from "crypto";
import { Account, Character } from "@mmoexile/db";
import {
  CharacterData,
  createDefaultCharacter,
  getPrefab,
  CharacterClassPrefab,
} from "@mmoexile/game-core";
import { accountRepo } from "./repositories/accountRepository.js";
import { characterRepo } from "./repositories/characterRepository.js";
import {
  CharacterMapper,
  CharacterUpdateState,
} from "./mappers/characterMapper.js";

export interface AccountLoginResult {
  account: Account;
  character: Character;
  domainCharacter: CharacterData;
}

export class AccountService {
  /**
   * Authenticates or creates an account and provisions an active character.
   */
  async loginOrRegister(
    nickname: string,
    token?: string,
    chosenClass: string = "wizard",
  ): Promise<AccountLoginResult> {
    let account = null;

    if (token) {
      account = await accountRepo.findByToken(token);
    }

    const classDef = getPrefab<CharacterClassPrefab>(chosenClass);
    if (!classDef) {
      throw new Error(`Invalid chosen class: ${chosenClass}`);
    }

    // Create account if not found
    if (!account) {
      const newToken = token || randomUUID();
      const cleanNick =
        nickname.trim().slice(0, 16) ||
        `Guest_${Math.floor(Math.random() * 9000 + 1000)}`;

      account = await accountRepo.createAccount({
        nickname: cleanNick,
        token: newToken,
      });
    }

    // Find active character for account
    let character = await characterRepo.findActiveByAccountId(account.id);

    // If character is dead or none exists, create a fresh one with class defaults
    if (!character) {
      const defaultDomainChar = createDefaultCharacter(
        account.nickname,
        classDef.id,
      );

      const createInput = CharacterMapper.toPersistenceCreate(
        defaultDomainChar,
        account.id,
        "nexus",
        20.0,
        20.0,
      );

      character = await characterRepo.create(createInput);
    }

    const domainCharacter = CharacterMapper.toDomain(
      character,
      account.nickname,
    );

    return { account, character, domainCharacter };
  }

  /**
   * Persists real-time character progression and movement to the database.
   */
  async persistCharacterState(
    charId: string,
    state: CharacterUpdateState,
  ): Promise<void> {
    try {
      const updateInput = CharacterMapper.toPersistenceUpdate(state);
      await characterRepo.updateState(charId, updateInput);
    } catch (err) {
      console.error("Failed to persist character state:", err);
    }
  }

  /**
   * Marks a character as dead in the database (permadeath).
   */
  async handleCharacterDeath(
    charId: string,
    deathReason?: string,
  ): Promise<void> {
    try {
      await characterRepo.markDead(charId, deathReason);
    } catch (err) {
      console.error("Failed to mark character dead:", err);
    }
  }
}

export const accountService = new AccountService();
