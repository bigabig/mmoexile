import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@mmoexile/db";
import { HttpError, MAX_CHARACTERS_PER_ACCOUNT, type AllocateRequest } from "@mmoexile/contracts";
import { createLogger } from "@mmoexile/service-kit";
import { readConfig } from "../config.js";
import { buildApp } from "../app.js";

let app: FastifyInstance;
/** What the fake orchestrator was asked; set `fleetFull` to answer 503. */
const allocations: AllocateRequest[] = [];
let fleetFull = false;

beforeAll(async () => {
  app = buildApp({
    config: readConfig({}),
    logger: createLogger("test", "silent"),
    db: prisma,
    allocate: async (request) => {
      if (fleetFull) throw new HttpError(503, "full");
      allocations.push(request);
      return { serverId: "s1", instanceId: "nexus:abcdef", url: "ws://nexus.test/ws", ticket: "t", ticketId: "id" };
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function guest(nickname = "Ann") {
  const res = await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname } });
  expect(res.statusCode).toBe(200);
  return res.json() as { accountId: string; sessionToken: string; refreshSecret: string };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function createCharacter(token: string, classId = "wizard") {
  return app.inject({ method: "POST", url: "/characters", headers: auth(token), payload: { classId } });
}

describe("auth", () => {
  it("creates guest accounts and stores only the hash of the refresh secret", async () => {
    const login = await guest("Ann");
    const row = await prisma.account.findUnique({ where: { id: login.accountId } });
    expect(row?.nickname).toBe("Ann");
    expect(row?.refreshSecretHash).not.toBe(login.refreshSecret);
  });

  it("refreshes a session with the refresh secret", async () => {
    const login = await guest();
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshSecret: login.refreshSecret },
    });
    expect(res.json()).toMatchObject({ accountId: login.accountId, nickname: "Ann" });

    const bad = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshSecret: "nope" } });
    expect(bad.statusCode).toBe(401);
  });

  it("validates input and rejects missing or bad sessions", async () => {
    const empty = await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname: "" } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toHaveProperty("error");

    expect((await app.inject("/characters")).statusCode).toBe(401);
    const forged = await app.inject({ url: "/characters", headers: auth("x.y.z") });
    expect(forged.statusCode).toBe(401);
  });
});

describe("characters", () => {
  it("creates, lists and deletes characters per account", async () => {
    const ann = await guest("Ann");
    const bob = await guest("Bob");
    const knight = (await createCharacter(ann.sessionToken, "knight")).json().character;
    expect(knight).toMatchObject({ classId: "knight", level: 1, isAlive: true, lastZoneId: "nexus" });

    const annList = (await app.inject({ url: "/characters", headers: auth(ann.sessionToken) })).json();
    const bobList = (await app.inject({ url: "/characters", headers: auth(bob.sessionToken) })).json();
    expect(annList.characters.map((c: any) => c.id)).toEqual([knight.id]);
    expect(bobList.characters).toEqual([]);

    // Bob can't delete Ann's character
    const steal = await app.inject({ method: "DELETE", url: `/characters/${knight.id}`, headers: auth(bob.sessionToken) });
    expect(steal.statusCode).toBe(404);
    const del = await app.inject({ method: "DELETE", url: `/characters/${knight.id}`, headers: auth(ann.sessionToken) });
    expect(del.json()).toEqual({ deleted: true });
  });

  it("stores class stats like the game does", async () => {
    const ann = await guest();
    const { character } = (await createCharacter(ann.sessionToken, "wizard")).json();
    const row = await prisma.character.findUnique({ where: { id: character.id } });
    expect(row).toMatchObject({ hp: 110, maxHp: 110, defense: 3, equippedWeapon: "staff_energy" });
    expect(row?.inventory).toEqual(new Array(8).fill(null));
  });

  it(`limits accounts to ${MAX_CHARACTERS_PER_ACCOUNT} living characters`, async () => {
    const ann = await guest();
    for (let i = 0; i < MAX_CHARACTERS_PER_ACCOUNT; i++) {
      expect((await createCharacter(ann.sessionToken)).statusCode).toBe(200);
    }
    expect((await createCharacter(ann.sessionToken)).statusCode).toBe(409);

    // Dead characters don't count
    const anyId = (await prisma.character.findFirst({ where: { accountId: ann.accountId } }))!.id;
    await prisma.character.update({ where: { id: anyId }, data: { isAlive: false } });
    expect((await createCharacter(ann.sessionToken)).statusCode).toBe(200);
  });

  it("rejects unknown classes", async () => {
    const ann = await guest();
    expect((await createCharacter(ann.sessionToken, "bard")).statusCode).toBe(400);
  });
});

describe("play", () => {
  it("asks the orchestrator for a nexus slot and passes on its ticket", async () => {
    const ann = await guest();
    const { character } = (await createCharacter(ann.sessionToken)).json();

    const res = await app.inject({
      method: "POST",
      url: "/play",
      headers: auth(ann.sessionToken),
      payload: { characterId: character.id },
    });

    expect(res.json()).toEqual({ url: "ws://nexus.test/ws", ticket: "t" });
    expect(allocations.at(-1)).toEqual({
      zoneId: "nexus",
      characterId: character.id,
      accountId: ann.accountId,
    });

    fleetFull = true;
    const full = await app.inject({
      method: "POST",
      url: "/play",
      headers: auth(ann.sessionToken),
      payload: { characterId: character.id },
    });
    fleetFull = false;
    expect(full.statusCode).toBe(503);
    expect(full.json().error).toMatch(/full/);
  });

  it("refuses foreign and dead characters", async () => {
    const ann = await guest();
    const bob = await guest("Bob");
    const { character } = (await createCharacter(ann.sessionToken)).json();
    const play = (token: string) =>
      app.inject({ method: "POST", url: "/play", headers: auth(token), payload: { characterId: character.id } });

    expect((await play(bob.sessionToken)).statusCode).toBe(404);
    await prisma.character.update({ where: { id: character.id }, data: { isAlive: false } });
    const dead = await play(ann.sessionToken);
    expect(dead.statusCode).toBe(409);
    expect(dead.json().error).toMatch(/dead/);
  });
});
