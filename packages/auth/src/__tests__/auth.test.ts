import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  generateSecret,
  hashSecret,
  InvalidTokenError,
  secretKey,
  secretMatchesHash,
  signSessionToken,
  signTicket,
  verifySessionToken,
  verifyTicket,
} from "../index.js";

const key = secretKey("a".repeat(32));
const otherKey = secretKey("b".repeat(32));

describe("secretKey", () => {
  it("refuses short secrets", () => {
    expect(() => secretKey("short")).toThrow(/at least 32/);
  });
});

describe("session tokens", () => {
  it("round-trips account claims", async () => {
    const token = await signSessionToken({ accountId: "acc1", nickname: "Ann" }, key);
    expect(await verifySessionToken(token, key)).toEqual({ accountId: "acc1", nickname: "Ann" });
  });

  it("rejects tokens signed with another key", async () => {
    const token = await signSessionToken({ accountId: "acc1", nickname: "Ann" }, otherKey);
    await expect(verifySessionToken(token, key)).rejects.toMatchObject({ reason: "invalid" });
  });

  it("reports expiry", async () => {
    const token = await signSessionToken({ accountId: "acc1", nickname: "Ann" }, key, -1);
    await expect(verifySessionToken(token, key)).rejects.toMatchObject({ reason: "expired" });
  });

  it("does not accept a ticket as a session token", async () => {
    const ticket = await signTicket(
      { characterId: "c", accountId: "a", zoneId: "nexus", targetServerId: "s" },
      key,
    );
    await expect(verifySessionToken(ticket, key)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("transfer tickets", () => {
  const claims = {
    characterId: "char1",
    accountId: "acc1",
    zoneId: "golem_dungeon",
    targetServerId: "b",
    partyId: "party_1",
    via: { sourceInstanceId: "overworld:abc123", portalId: "portal_to_dungeon_1" },
  };

  it("round-trips claims with a unique ticket id", async () => {
    const t1 = await verifyTicket(await signTicket(claims, key), key, "b");
    const t2 = await verifyTicket(await signTicket(claims, key), key, "b");

    expect(t1).toMatchObject(claims);
    expect(t1.ticketId).not.toBe(t2.ticketId);
    expect(t1.expiresAt).toBeGreaterThan(Date.now());
  });

  it("is only valid on its target server", async () => {
    const ticket = await signTicket(claims, key);
    await expect(verifyTicket(ticket, key, "a")).rejects.toMatchObject({ reason: "invalid" });
  });

  it("expires", async () => {
    const ticket = await signTicket(claims, key, -1);
    await expect(verifyTicket(ticket, key, "b")).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects session tokens and tampered tickets", async () => {
    const session = await signSessionToken({ accountId: "a", nickname: "n" }, key);
    await expect(verifyTicket(session, key, "b")).rejects.toBeInstanceOf(InvalidTokenError);

    const forged = await new SignJWT({ acc: "a", zone: "nexus", srv: "b" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("c")
      .setAudience("mmoexile:ticket")
      .setExpirationTime("30s")
      .sign(otherKey);
    await expect(verifyTicket(forged, key, "b")).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("secrets", () => {
  it("stores only a hash and verifies against it", () => {
    const secret = generateSecret();
    const hash = hashSecret(secret);
    expect(hash).not.toContain(secret);
    expect(secretMatchesHash(secret, hash)).toBe(true);
    expect(secretMatchesHash(generateSecret(), hash)).toBe(false);
  });
});
