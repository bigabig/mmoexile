import { describe, it, expect, vi } from "vitest";
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
  ticketSigningKey,
  ticketVerificationKey,
  generateTicketKeyPair,
  assertNotDevSecrets,
  DEV_TICKET_PRIVATE_KEY,
  DEV_TICKET_PUBLIC_KEY,
} from "../index.js";

const key = secretKey("a".repeat(32));
const otherKey = secretKey("b".repeat(32));
const signing = await ticketSigningKey(DEV_TICKET_PRIVATE_KEY);
const verifying = await ticketVerificationKey(DEV_TICKET_PUBLIC_KEY);

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
      { characterId: "c", accountId: "a", zoneId: "nexus", targetServerId: "s", region: "eu" },
      signing,
    );
    await expect(verifySessionToken(ticket, key)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe("transfer tickets", () => {
  const claims = {
    characterId: "char1",
    accountId: "acc1",
    zoneId: "golem_dungeon",
    instanceId: "golem_dungeon:7f3a9c",
    targetServerId: "b",
    region: "eu",
    fromRegion: "us",
    partyId: "party_1",
    via: { sourceInstanceId: "overworld:abc123", portalId: "portal_to_dungeon_1" },
  };

  it("round-trips claims with a unique ticket id", async () => {
    const t1 = await verifyTicket(await signTicket(claims, signing), verifying, "b");
    const t2 = await verifyTicket(await signTicket(claims, signing), verifying, "b");

    expect(t1).toMatchObject(claims);
    expect(t1.ticketId).not.toBe(t2.ticketId);
    expect((await verifyTicket(await signTicket({ ...claims, ticketId: "t-1" }, signing), verifying, "b")).ticketId).toBe("t-1");
    expect(t1.expiresAt).toBeGreaterThan(Date.now());
    expect(Math.abs(t1.issuedAt - Date.now())).toBeLessThan(1000);
  });

  it("records the issue time to the millisecond (to time handoffs)", async () => {
    vi.useFakeTimers({ now: 1_790_000_000_123 });
    try {
      const ticket = await verifyTicket(await signTicket(claims, signing), verifying, "b");
      expect(ticket.issuedAt).toBe(1_790_000_000_123);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is only valid on its target server", async () => {
    const ticket = await signTicket(claims, signing);
    await expect(verifyTicket(ticket, verifying, "a")).rejects.toMatchObject({ reason: "invalid" });
  });

  it("expires", async () => {
    const ticket = await signTicket(claims, signing, -1);
    await expect(verifyTicket(ticket, verifying, "b")).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects session tokens and tampered tickets", async () => {
    const session = await signSessionToken({ accountId: "a", nickname: "n" }, key);
    await expect(verifyTicket(session, verifying, "b")).rejects.toBeInstanceOf(InvalidTokenError);

    // Signed with a shared secret instead of the orchestrator's private key
    const forged = await new SignJWT({ acc: "a", zone: "nexus", srv: "b" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("c")
      .setAudience("mmoexile:ticket")
      .setExpirationTime("30s")
      .sign(otherKey);
    await expect(verifyTicket(forged, verifying, "b")).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("only verifies with the matching public key", async () => {
    const other = await generateTicketKeyPair();
    const ticket = await signTicket(claims, await ticketSigningKey(other.privateKey));
    expect((await verifyTicket(ticket, await ticketVerificationKey(other.publicKey), "b")).characterId).toBe("char1");
    await expect(verifyTicket(ticket, verifying, "b")).rejects.toMatchObject({ reason: "invalid" });
  });

  it("accepts full PEM files and rejects dev keys in production", async () => {
    const pem = `-----BEGIN PUBLIC KEY-----\n${DEV_TICKET_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;
    const ticket = await signTicket(claims, signing);
    expect((await verifyTicket(ticket, await ticketVerificationKey(pem), "b")).targetServerId).toBe("b");
    expect(() => assertNotDevSecrets("production", [DEV_TICKET_PRIVATE_KEY])).toThrow();
    expect(() => assertNotDevSecrets("development", [DEV_TICKET_PRIVATE_KEY])).not.toThrow();
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
