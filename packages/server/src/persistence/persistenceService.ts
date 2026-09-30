import { accountService } from "./accountService.js";
import type { CharacterUpdateState } from "./mappers/characterMapper.js";

export class PersistenceService {
  private pendingSaves = new Map<string, CharacterUpdateState>();
  private isFlushing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlightWrites = 0;

  constructor(flushIntervalMs: number = 2000) {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) =>
        console.error("[PersistenceService] Background flush error:", err),
      );
    }, flushIntervalMs);
  }

  public queueSave(charId: string, state: CharacterUpdateState): void {
    this.pendingSaves.set(charId, state);
  }

  public async saveImmediate(
    charId: string,
    state: CharacterUpdateState,
  ): Promise<void> {
    this.pendingSaves.delete(charId);
    this.inFlightWrites++;
    try {
      await accountService.persistCharacterState(charId, state);
    } catch (err) {
      console.error(
        `[PersistenceService] Failed to persist character ${charId}:`,
        err,
      );
    } finally {
      this.inFlightWrites--;
    }
  }

  public async handleDeath(charId: string): Promise<void> {
    this.pendingSaves.delete(charId);
    this.inFlightWrites++;
    try {
      await accountService.handleCharacterDeath(charId);
    } catch (err) {
      console.error(
        `[PersistenceService] Failed to record death for character ${charId}:`,
        err,
      );
    } finally {
      this.inFlightWrites--;
    }
  }

  public async flush(): Promise<void> {
    while (this.inFlightWrites > 0 || this.pendingSaves.size > 0) {
      if (this.isFlushing) {
        await new Promise((res) => setTimeout(res, 50));
        continue;
      }
      if (this.pendingSaves.size === 0 && this.inFlightWrites > 0) {
        await new Promise((res) => setTimeout(res, 50));
        continue;
      }
      this.isFlushing = true;
      const entries = Array.from(this.pendingSaves.entries());
      this.pendingSaves.clear();

      for (const [charId, state] of entries) {
        try {
          await accountService.persistCharacterState(charId, state);
        } catch (err) {
          console.error(
            `[PersistenceService] Failed to batch-persist character ${charId}:`,
            err,
          );
        }
      }
      this.isFlushing = false;
    }
  }

  public async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

export const persistenceService = new PersistenceService();
