import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { channels, type ChannelMessage } from "@mmoexile/contracts";
import { InMemoryBroker, Redis } from "@mmoexile/messaging";
import { createLogger } from "@mmoexile/service-kit";
import { buildApp } from "../app.js";

let app: FastifyInstance;
let redis: Redis;
const updates: ChannelMessage<typeof channels.partyUpdated>[] = [];

beforeAll(async () => {
  redis = new Redis(process.env.TEST_REDIS_URL!);
  const broker = new InMemoryBroker();
  await broker.subscribe(channels.partyUpdated, (m) => updates.push(m));
  app = buildApp({ logger: createLogger("test", "silent"), redis, broker });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

let n = 0;
const id = () => `char-${Date.now()}-${n++}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = async (url: string, payload: object): Promise<any> =>
  (await app.inject({ method: "POST", url, payload })).json();

describe("social parties", () => {
  it("forms a party on accept and publishes the change", async () => {
    const [a, b] = [id(), id()];
    expect(await post("/parties/invite", { inviterId: a, inviteeId: b })).toEqual({ ok: true, party: null });
    const accepted = await post("/parties/accept", { characterId: b });

    expect(accepted.ok).toBe(true);
    expect(accepted.party).toMatchObject({ leaderId: a, members: [a, b] });
    expect(updates.at(-1)).toMatchObject({ party: { members: [a, b] }, removed: [] });
    expect((await post("/parties/of", { characterId: b })).party.id).toBe(accepted.party.id);
  });

  it("rejects bad invites and accepts without an invite", async () => {
    const [a, b, c] = [id(), id(), id()];
    expect((await post("/parties/invite", { inviterId: a, inviteeId: a })).ok).toBe(false);
    await post("/parties/invite", { inviterId: a, inviteeId: b });
    await post("/parties/accept", { characterId: b });
    expect((await post("/parties/invite", { inviterId: c, inviteeId: b })).reason).toMatch(/already in a party/);
    expect((await post("/parties/accept", { characterId: c })).reason).toMatch(/no pending/);
  });

  it("hands leadership on and disbands a party of one", async () => {
    const [a, b, c] = [id(), id(), id()];
    await post("/parties/invite", { inviterId: a, inviteeId: b });
    await post("/parties/accept", { characterId: b });
    await post("/parties/invite", { inviterId: a, inviteeId: c });
    await post("/parties/accept", { characterId: c });

    const afterLeader = await post("/parties/leave", { characterId: a });
    expect(afterLeader.party.leaderId).toBe(b);

    const disband = await post("/parties/leave", { characterId: b });
    expect(disband).toEqual({ ok: true, party: null });
    expect(updates.at(-1)?.removed.sort()).toEqual([b, c].sort());
    expect((await post("/parties/of", { characterId: c })).party).toBeNull();
  });

  it("serializes concurrent accepts so a party never exceeds its size", async () => {
    const leader = id();
    const invitees = Array.from({ length: 8 }, () => id());
    // Leader invites everyone first; the first accept forms the party
    for (const inv of invitees) await post("/parties/invite", { inviterId: leader, inviteeId: inv });
    const results = await Promise.all(invitees.map((inv) => post("/parties/accept", { characterId: inv })));

    const party = (await post("/parties/of", { characterId: leader })).party;
    expect(party.members).toHaveLength(6);
    expect(results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(5);
  });

  it("validates request bodies", async () => {
    const res = await app.inject({ method: "POST", url: "/parties/invite", payload: { inviterId: 1 } });
    expect(res.statusCode).toBe(400);
  });
});
