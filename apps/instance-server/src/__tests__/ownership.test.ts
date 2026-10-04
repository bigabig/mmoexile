import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@mmoexile/db";
import { Redis } from "@mmoexile/messaging";
import { CharacterOwnership } from "../ownership/CharacterOwnership.js";
import { LeaseKeeper } from "../ownership/LeaseKeeper.js";

let redis: Redis;
const A = { serverId: "a" };
const B = { serverId: "b" };

beforeAll(() => {
  redis = new Redis(process.env.TEST_REDIS_URL!);
});

afterAll(async () => {
  await redis.quit();
});

async function newCharacter(): Promise<string> {
  const account = await prisma.account.create({
    data: { nickname: "Owner", refreshSecretHash: `hash-${Math.random()}` },
  });
  const character = await prisma.character.create({
    data: { accountId: account.id },
  });
  return character.id;
}

const ownershipFor = (leaseTtlMs = 30_000) =>
  new CharacterOwnership({ redis, db: prisma, leaseTtlMs });

describe("CharacterOwnership", () => {
  it("grants the lease to one server at a time with increasing epochs", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor();

    const first = await ownership.acquire(id, A);
    // Taking ownership also loads the latest save, with the account's nickname
    expect(first).toMatchObject({ ok: true, ownership: { epoch: 1 }, character: { id, hp: 100, ownerEpoch: 1 } });
    expect(first.ok && first.character.nickname).toMatch(/\S/);

    const second = await ownership.acquire(id, B);
    expect(second).toEqual({ ok: false, reason: "held", heldBy: { serverId: "a" } });

    expect(first.ok && (await ownership.release(first.ownership))).toBe(true);
    const third = await ownership.acquire(id, B);
    expect(third).toMatchObject({ ok: true, ownership: { epoch: 2 } });
  });

  it("fences the old owner after a forced takeover", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor();
    const a = await ownership.acquire(id, A);
    if (!a.ok) throw new Error("expected lease");

    expect(await ownership.writeFenced(a.ownership, { hp: 50 })).toBe(true);

    const b = (await ownership.forceAcquire(id, B))!.ownership;
    expect(b.epoch).toBe(a.ownership.epoch + 1);

    // A can no longer write, renew, or release B's lease
    expect(await ownership.writeFenced(a.ownership, { hp: 1 })).toBe(false);
    expect(await ownership.renew(a.ownership)).toBe(false);
    expect(await ownership.release(a.ownership)).toBe(false);
    expect(await ownership.renew(b)).toBe(true);
    expect(await ownership.writeFenced(b, { hp: 77 })).toBe(true);

    const row = await prisma.character.findUnique({ where: { id } });
    expect(row?.hp).toBe(77);
  });

  it("lets another server claim the character after the lease expires", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor(150);
    const a = await ownership.acquire(id, A);
    if (!a.ok) throw new Error("expected lease");

    await new Promise((r) => setTimeout(r, 250)); // A "crashed" and stopped renewing

    const b = await ownership.acquire(id, B);
    expect(b.ok).toBe(true);
    expect(await ownership.writeFenced(a.ownership, { hp: 1 })).toBe(false);
  });

  it("rolls the lease back for a character that doesn't exist", async () => {
    const ownership = ownershipFor();
    expect(await ownership.acquire("no-such-character", A)).toEqual({ ok: false, reason: "missing" });
    // The reservation was removed, so a later claim isn't blocked
    expect(await redis.exists("lease:char:no-such-character")).toBe(0);
    expect(await ownership.forceAcquire("no-such-character", A)).toBeUndefined();
  });

  it("claims a one-time key (a ticket) together with the lease, and only once", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor();
    const claimOnce = { key: `ticket:used:t-${id}`, value: "a", ttlMs: 60_000 };

    const first = await ownership.acquire(id, A, { claimOnce });
    expect(first.ok).toBe(true);
    expect(await redis.get(claimOnce.key)).toBe("a");
    if (first.ok) await ownership.release(first.ownership);

    // A replay is refused before the lease is touched
    expect(await ownership.acquire(id, B, { claimOnce })).toEqual({ ok: false, reason: "claimed" });
    expect(await redis.exists(`lease:char:${id}`)).toBe(0);
  });

  it("writes only the given columns, JSON included, in one fenced statement", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor();
    const a = await ownership.acquire(id, A);
    if (!a.ok) throw new Error("expected lease");
    const inventory = ["sword_iron", null, null, null, null, null, null, "potion"];
    expect(
      await ownership.writeFenced(a.ownership, { hp: 42, x: 12.5, isAlive: true, equippedArmor: null, inventory }),
    ).toBe(true);
    const row = await prisma.character.findUnique({ where: { id } });
    expect(row).toMatchObject({ hp: 42, x: 12.5, isAlive: true, equippedArmor: null, inventory, level: 1 });
    await expect(ownership.writeFenced(a.ownership, { ownerEpoch: 99 })).rejects.toThrow(/unsupported/);
  });
});

describe("LeaseKeeper", () => {
  it("renews held leases and reports the ones taken over", async () => {
    const id = await newCharacter();
    const ownership = ownershipFor();
    const lost: string[] = [];
    const keeper = new LeaseKeeper(ownership, (characterId) => lost.push(characterId));

    const a = await ownership.acquire(id, A);
    if (!a.ok) throw new Error("expected lease");
    keeper.track(a.ownership);

    await keeper.renewAll();
    expect(lost).toEqual([]);
    expect(await redis.pttl(`lease:char:${id}`)).toBeGreaterThan(29_000);

    await ownership.forceAcquire(id, B);
    await keeper.renewAll();
    expect(lost).toEqual([id]);
    expect(keeper.get(id)).toBeUndefined();
  });
});
