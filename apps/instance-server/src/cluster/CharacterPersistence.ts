import type { PlayerPersistenceSnapshot } from "@mmoexile/simulation";

/**
 * Where InstanceHost sends character state. The instance server plugs in
 * fenced writes (only the lease holder may write); tests use the no-op.
 */
export interface CharacterPersistence {
  /** Batched background save (periodic snapshots). */
  queueSave(characterId: string, state: PlayerPersistenceSnapshot): void;
  /** Save right away (e.g. on disconnect). */
  saveImmediate(
    characterId: string,
    state: PlayerPersistenceSnapshot,
  ): Promise<void>;
  /** Record a permadeath. */
  handleDeath(characterId: string): Promise<void>;
}

export const NO_PERSISTENCE: CharacterPersistence = {
  queueSave: () => {},
  saveImmediate: async () => {},
  handleDeath: async () => {},
};
