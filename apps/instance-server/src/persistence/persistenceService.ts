import type { CharacterUpdateState } from "./mappers/characterMapper.js";
import type { CharacterPersistence } from "../cluster/CharacterPersistence.js";

/** Performs the actual database writes (fenced in production). */
export interface CharacterWriter {
  writeState(charId: string, state: CharacterUpdateState): Promise<void>;
  markDead(charId: string): Promise<void>;
}

/**
 * Batches character saves out of band from the game loop: periodic snapshots
 * are queued and flushed every few seconds, disconnects and deaths are
 * written right away, and stop() drains everything for shutdown.
 */
export class PersistenceService implements CharacterPersistence {
  private pendingSaves = new Map<string, CharacterUpdateState>();
  private isFlushing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlightWrites = 0;

  constructor(
    private readonly writer: CharacterWriter,
    flushIntervalMs: number = 2000,
  ) {
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
      await this.writer.writeState(charId, state);
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
      await this.writer.markDead(charId);
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
          await this.writer.writeState(charId, state);
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

