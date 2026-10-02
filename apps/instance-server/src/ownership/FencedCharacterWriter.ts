import {
  CharacterMapper,
  type CharacterUpdateState,
  type CharacterWriter,
} from "../persistence/index.js";
import type { CharacterOwnership } from "./CharacterOwnership.js";
import type { LeaseKeeper } from "./LeaseKeeper.js";

/**
 * Writes character state only while this server owns the character. A write
 * for a character we don't own is skipped; a fenced write (someone else took
 * over) reports the character via `onFenced` so it can be dropped.
 */
export class FencedCharacterWriter implements CharacterWriter {
  constructor(
    private readonly ownership: CharacterOwnership,
    private readonly leases: LeaseKeeper,
    private readonly onFenced: (characterId: string) => void,
  ) {}

  async writeState(charId: string, state: CharacterUpdateState): Promise<void> {
    await this.write(charId, CharacterMapper.toPersistenceUpdate(state));
  }

  async markDead(charId: string): Promise<void> {
    await this.write(charId, {
      isAlive: false,
      deathReason: "Slain in the realm",
    });
  }

  private async write(
    charId: string,
    data: Parameters<CharacterOwnership["writeFenced"]>[1],
  ): Promise<void> {
    const held = this.leases.get(charId);
    if (!held) return;
    if (!(await this.ownership.writeFenced(held, data))) {
      this.leases.untrack(charId);
      this.onFenced(charId);
    }
  }
}
