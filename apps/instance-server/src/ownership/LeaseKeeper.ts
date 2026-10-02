import type { CharacterOwnership, Ownership } from "./CharacterOwnership.js";

/**
 * Keeps the leases of every character on this server alive. A lease that
 * can't be renewed means another server owns the character now; `onLost`
 * must then drop the character without saving.
 */
export class LeaseKeeper {
  private held = new Map<string, Ownership>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ownership: CharacterOwnership,
    private readonly onLost: (characterId: string) => void,
    private readonly onError: (err: unknown) => void = (err) =>
      console.error("[LeaseKeeper] Renewal failed:", err),
  ) {}

  start(intervalMs = Math.floor(this.ownership.leaseTtlMs / 3)): void {
    this.timer = setInterval(() => void this.renewAll(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  track(ownership: Ownership): void {
    this.held.set(ownership.characterId, ownership);
  }

  untrack(characterId: string): Ownership | undefined {
    const ownership = this.held.get(characterId);
    this.held.delete(characterId);
    return ownership;
  }

  get(characterId: string): Ownership | undefined {
    return this.held.get(characterId);
  }

  all(): Ownership[] {
    return [...this.held.values()];
  }

  async renewAll(): Promise<void> {
    await Promise.all(
      this.all().map(async (ownership) => {
        try {
          if (!(await this.ownership.renew(ownership))) {
            this.held.delete(ownership.characterId);
            this.onLost(ownership.characterId);
          }
        } catch (err) {
          // Redis unreachable: keep trying; fenced writes still protect data.
          this.onError(err);
        }
      }),
    );
  }
}
