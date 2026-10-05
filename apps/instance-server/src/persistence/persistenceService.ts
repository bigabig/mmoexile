import type { CharacterUpdateState } from "./mappers/characterMapper.js";
import type { CharacterPersistence } from "../cluster/CharacterPersistence.js";

/** Performs the actual database writes (fenced in production). */
export interface CharacterWriter {
  writeState(charId: string, state: CharacterUpdateState): Promise<void>;
  markDead(charId: string): Promise<void>;
}

/** periodic: snapshots while playing; final: when leaving the server; death: permadeath */
export type SaveKind = "periodic" | "final" | "death";

export interface PersistenceOptions {
  flushIntervalMs?: number;
  /**
   * True if a failed write may succeed later (the database is unavailable):
   * it is kept and retried. Other errors are logged and the write dropped.
   */
  isTransient?: (err: unknown) => boolean;
  /** After a transient failure, wait retryBaseMs × 2^(failures-1), at most retryMaxMs. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  now?: () => number;
  /** A write failed (metrics, logs); `retrying` if it is kept for later. */
  onWriteFailed?: (kind: SaveKind, err: unknown, retrying: boolean) => void;
}

interface FinalSave {
  state: CharacterUpdateState;
  onLanded: () => void;
}

/**
 * Character saves, out of band from the game loop:
 * - periodic snapshots are queued and flushed every few seconds; only the
 *   newest per character is kept;
 * - deaths and final saves (leaving the server) are written right away.
 *
 * While the database is unavailable nothing is lost: failed writes are kept
 * (deaths first, then final saves, then snapshots; newest state wins) and
 * retried with backoff, and `available` turns false so callers can avoid
 * starting what needs the database (zone changes). A final save's
 * `onLanded` runs once it is written, so the caller can keep the
 * character's lease until then.
 */
export class PersistenceService implements CharacterPersistence {
  private pendingSaves = new Map<string, CharacterUpdateState>();
  private pendingDeaths = new Set<string>();
  private pendingFinal = new Map<string, FinalSave>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private inFlightWrites = 0;
  private failures = 0;
  private retryAt = 0;
  private readonly isTransient: (err: unknown) => boolean;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => number;
  private readonly onWriteFailed: NonNullable<PersistenceOptions["onWriteFailed"]>;

  constructor(
    private readonly writer: CharacterWriter,
    options: PersistenceOptions | number = {},
  ) {
    const opts = typeof options === "number" ? { flushIntervalMs: options } : options;
    this.isTransient = opts.isTransient ?? (() => false);
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
    this.retryMaxMs = opts.retryMaxMs ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.onWriteFailed =
      opts.onWriteFailed ??
      ((kind, err, retrying) =>
        console.error(`[PersistenceService] ${kind} save failed${retrying ? ", will retry" : ""}:`, err));
    this.flushTimer = setInterval(() => void this.flush(), opts.flushIntervalMs ?? 2000);
    this.flushTimer.unref?.();
  }

  /** False after a write failed because the database was unavailable, until one succeeds. */
  get available(): boolean {
    return this.failures === 0;
  }

  /** Writes waiting for the database (gauge). */
  get pending(): number {
    return this.pendingSaves.size + this.pendingDeaths.size + this.pendingFinal.size;
  }

  public queueSave(charId: string, state: CharacterUpdateState): void {
    // Leaving or left: the final save already has the newest state
    if (this.pendingFinal.has(charId)) return;
    this.pendingSaves.set(charId, state);
  }

  public async saveImmediate(charId: string, state: CharacterUpdateState): Promise<void> {
    this.pendingSaves.delete(charId);
    if (!(await this.attempt("periodic", () => this.writer.writeState(charId, state)))) {
      if (!this.pendingSaves.has(charId) && !this.pendingFinal.has(charId)) {
        this.pendingSaves.set(charId, state);
      }
    }
  }

  public async handleDeath(charId: string): Promise<void> {
    this.pendingSaves.delete(charId);
    if (!(await this.attempt("death", () => this.writer.markDead(charId)))) {
      this.pendingDeaths.add(charId);
    }
  }

  /**
   * The last save of a character leaving this server. Resolves true once it
   * is written (or failed for good), false if the database is unavailable:
   * then it is retried in the background and `onLanded` runs when written.
   * A pending death of the character is written first.
   */
  public async saveFinal(charId: string, state: CharacterUpdateState, onLanded: () => void): Promise<boolean> {
    this.pendingSaves.delete(charId);
    const queue = () => {
      this.pendingFinal.set(charId, { state, onLanded });
      return false;
    };
    // Known to be down: don't make the caller wait for another timeout
    if (!this.available) return queue();
    if (this.pendingDeaths.has(charId)) {
      if (!(await this.attempt("death", () => this.writer.markDead(charId)))) return queue();
      this.pendingDeaths.delete(charId);
    }
    if (!(await this.attempt("final", () => this.writer.writeState(charId, state)))) return queue();
    return true;
  }

  /**
   * Writes what is queued: deaths, final saves, snapshots. Stops at the
   * first transient failure (the database is unavailable: no point trying
   * the rest now) and waits for the backoff before the next attempt.
   */
  public flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    if (this.now() < this.retryAt) return;
    for (const charId of [...this.pendingDeaths]) {
      if (!(await this.attempt("death", () => this.writer.markDead(charId)))) return;
      this.pendingDeaths.delete(charId);
    }
    for (const [charId, final] of [...this.pendingFinal]) {
      if (this.pendingDeaths.has(charId)) continue;
      if (!(await this.attempt("final", () => this.writer.writeState(charId, final.state)))) return;
      if (this.pendingFinal.get(charId) === final) this.pendingFinal.delete(charId);
      final.onLanded();
    }
    for (const [charId, state] of [...this.pendingSaves]) {
      if (this.pendingSaves.get(charId) !== state) continue; // a newer one came in meanwhile
      this.pendingSaves.delete(charId);
      if (!(await this.attempt("periodic", () => this.writer.writeState(charId, state)))) {
        if (!this.pendingSaves.has(charId)) this.pendingSaves.set(charId, state);
        return;
      }
    }
  }

  /**
   * One write. True if it is done (written, or failed for good and
   * dropped), false if it should be retried later.
   */
  private async attempt(kind: SaveKind, write: () => Promise<void>): Promise<boolean> {
    this.inFlightWrites++;
    try {
      await write();
      this.failures = 0;
      this.retryAt = 0;
      return true;
    } catch (err) {
      const retrying = this.isTransient(err);
      this.onWriteFailed(kind, err, retrying);
      if (!retrying) return true;
      this.failures++;
      this.retryAt = this.now() + Math.min(this.retryBaseMs * 2 ** (this.failures - 1), this.retryMaxMs);
      return false;
    } finally {
      this.inFlightWrites--;
    }
  }

  /**
   * Shutdown: writes everything still queued, retrying while the database
   * is unavailable, for at most `timeoutMs`. Returns how many writes were
   * given up.
   */
  public async stop(timeoutMs = 20_000): Promise<number> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    const deadline = this.now() + timeoutMs;
    while ((this.pending > 0 || this.inFlightWrites > 0) && this.now() < deadline) {
      await this.flush();
      if (this.pending > 0 || this.inFlightWrites > 0) await new Promise((r) => setTimeout(r, 50));
    }
    return this.pending;
  }
}
