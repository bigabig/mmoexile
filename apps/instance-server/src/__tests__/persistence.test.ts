import { describe, it, expect } from "vitest";
import { PersistenceService, type CharacterWriter } from "../persistence/index.js";
import type { CharacterUpdateState } from "../persistence/mappers/characterMapper.js";

const UNAVAILABLE = new Error("database unavailable");

/** A writer whose database can go down; records what was written. */
function flakyWriter() {
  const writes: string[] = [];
  const db = { down: false, attempts: 0 };
  const writer: CharacterWriter = {
    async writeState(charId, state) {
      db.attempts++;
      if (db.down) throw UNAVAILABLE;
      writes.push(`${charId} xp=${state.xp}`);
    },
    async markDead(charId) {
      db.attempts++;
      if (db.down) throw UNAVAILABLE;
      writes.push(`${charId} dead`);
    },
  };
  return { writes, db, writer };
}

const state = (xp: number) => ({ xp }) as unknown as CharacterUpdateState;

function service(writer: CharacterWriter, clock: { now: number }) {
  const failures: string[] = [];
  const persistence = new PersistenceService(writer, {
    flushIntervalMs: 60_000, // flushed by hand
    isTransient: (err) => err === UNAVAILABLE,
    retryBaseMs: 1000,
    retryMaxMs: 4000,
    now: () => clock.now,
    onWriteFailed: (kind, _err, retrying) => void failures.push(`${kind}${retrying ? " retrying" : ""}`),
  });
  return { persistence, failures };
}

describe("PersistenceService while the database is unavailable", () => {
  it("keeps failed snapshots, newest wins, and writes them once it is back", async () => {
    const clock = { now: 0 };
    const { writes, db, writer } = flakyWriter();
    const { persistence, failures } = service(writer, clock);

    db.down = true;
    persistence.queueSave("a", state(1));
    persistence.queueSave("b", state(1));
    await persistence.flush();
    // Stopped at the first failure: no point trying the rest now
    expect(db.attempts).toBe(1);
    expect(persistence.available).toBe(false);
    expect(persistence.pending).toBe(2);

    persistence.queueSave("a", state(2)); // newer state while down
    db.down = false;
    await persistence.flush(); // still in the backoff: nothing tried
    expect(db.attempts).toBe(1);

    clock.now = 1000;
    await persistence.flush();
    expect(writes.sort()).toEqual(["a xp=2", "b xp=1"]);
    expect(persistence.available).toBe(true);
    expect(persistence.pending).toBe(0);
    expect(failures).toEqual(["periodic retrying"]);
    await persistence.stop();
  });

  it("backs off exponentially, up to the maximum", async () => {
    const clock = { now: 0 };
    const { db, writer } = flakyWriter();
    const { persistence } = service(writer, clock);
    db.down = true;
    persistence.queueSave("a", state(1));

    const attemptsAt: number[] = [];
    for (clock.now = 0; clock.now <= 12_000; clock.now += 250) {
      const before = db.attempts;
      await persistence.flush();
      if (db.attempts > before) attemptsAt.push(clock.now);
    }
    // waits of 1, 2, 4, 4, ... seconds
    expect(attemptsAt).toEqual([0, 1000, 3000, 7000, 11_000]);
    db.down = false;
    clock.now = 20_000;
    await persistence.stop();
  });

  it("retries deaths, and writes a death before the character's final save", async () => {
    const clock = { now: 0 };
    const { writes, db, writer } = flakyWriter();
    const { persistence } = service(writer, clock);

    db.down = true;
    await persistence.handleDeath("a");
    const landed: string[] = [];
    // Known to be down: the final save is queued without another attempt
    const attempts = db.attempts;
    expect(await persistence.saveFinal("a", state(5), () => void landed.push("a"))).toBe(false);
    expect(db.attempts).toBe(attempts);

    db.down = false;
    clock.now = 10_000;
    await persistence.flush();
    expect(writes).toEqual(["a dead", "a xp=5"]);
    expect(landed).toEqual(["a"]);
    await persistence.stop();
  });

  it("final saves: written at once when possible, else in the background with onLanded", async () => {
    const clock = { now: 0 };
    const { writes, db, writer } = flakyWriter();
    const { persistence } = service(writer, clock);
    const landed: string[] = [];

    expect(await persistence.saveFinal("a", state(1), () => void landed.push("a"))).toBe(true);
    expect(landed).toEqual([]); // the caller releases right away

    db.down = true;
    expect(await persistence.saveFinal("b", state(1), () => void landed.push("b"))).toBe(false);
    persistence.queueSave("b", state(0)); // a late snapshot doesn't replace the final state
    db.down = false;
    clock.now = 1000;
    await persistence.flush();
    expect(writes).toEqual(["a xp=1", "b xp=1"]);
    expect(landed).toEqual(["b"]);
    await persistence.stop();
  });

  it("drops writes that fail for good, instead of retrying forever", async () => {
    const clock = { now: 0 };
    const writer: CharacterWriter = {
      writeState: async () => {
        throw new Error("value too long for column");
      },
      markDead: async () => {},
    };
    const { persistence, failures } = service(writer, clock);
    persistence.queueSave("a", state(1));
    await persistence.flush();
    expect(persistence.pending).toBe(0);
    expect(persistence.available).toBe(true);
    expect(failures).toEqual(["periodic"]);
    await persistence.stop();
  });

  it("gives up on shutdown after the timeout, reporting what was lost", async () => {
    const { db, writer } = flakyWriter();
    const persistence = new PersistenceService(writer, {
      isTransient: (err) => err === UNAVAILABLE,
      retryBaseMs: 10,
      onWriteFailed: () => {},
    });
    db.down = true;
    persistence.queueSave("a", state(1));
    expect(await persistence.stop(200)).toBe(1);
  });
});
