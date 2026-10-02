import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";

/**
 * Two kinds of signed tokens (JWT, HS256):
 * - Session token: "this is account X". Issued by account-api, verifiable by
 *   any service that knows the session secret.
 * - Transfer ticket: "character C may enter zone Z on server S", valid for
 *   seconds. Required on every connection to an instance server.
 */

const MIN_SECRET_LENGTH = 32;

/**
 * Development-only signing secrets, so local setups need no configuration.
 * Services refuse to start with these when NODE_ENV=production.
 */
export const DEV_SESSION_SECRET = "dev-only-session-secret-do-not-use-in-prod";
export const DEV_TICKET_SECRET = "dev-only-ticket-secret-do-not-use-in-prod!";

export function assertNotDevSecrets(
  nodeEnv: string,
  secrets: string[],
): void {
  if (
    nodeEnv === "production" &&
    secrets.some((s) => s === DEV_SESSION_SECRET || s === DEV_TICKET_SECRET)
  ) {
    throw new Error("Development signing secrets are not allowed in production");
  }
}
const SESSION_AUDIENCE = "mmoexile:session";
const TICKET_AUDIENCE = "mmoexile:ticket";

export function secretKey(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Signing secrets must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return new TextEncoder().encode(secret);
}

export class InvalidTokenError extends Error {
  constructor(public readonly reason: "expired" | "invalid") {
    super(reason === "expired" ? "Token expired" : "Invalid token");
  }
}

async function verify(token: string, key: Uint8Array, audience: string) {
  try {
    return (await jwtVerify(token, key, { audience, algorithms: ["HS256"] }))
      .payload;
  } catch (err) {
    throw new InvalidTokenError(
      err instanceof errors.JWTExpired ? "expired" : "invalid",
    );
  }
}

// --- Session tokens ---

export interface SessionClaims {
  accountId: string;
  nickname: string;
}

export async function signSessionToken(
  claims: SessionClaims,
  key: Uint8Array,
  ttlSeconds = 24 * 3600,
): Promise<string> {
  return new SignJWT({ name: claims.nickname })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.accountId)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifySessionToken(
  token: string,
  key: Uint8Array,
): Promise<SessionClaims> {
  const payload = await verify(token, key, SESSION_AUDIENCE);
  if (typeof payload.sub !== "string" || typeof payload.name !== "string") {
    throw new InvalidTokenError("invalid");
  }
  return { accountId: payload.sub, nickname: payload.name };
}

// --- Transfer tickets ---

export interface TicketClaims {
  characterId: string;
  accountId: string;
  /** Zone to enter on the target server. */
  zoneId: string;
  /** Server the ticket is valid for; other servers must reject it. */
  targetServerId: string;
  partyId?: string;
  /** Portal used, for portal_bound zones. */
  via?: { sourceInstanceId: string; portalId: string };
}

export interface VerifiedTicket extends TicketClaims {
  /** Unique ticket ID; claim it once to prevent replays. */
  ticketId: string;
  expiresAt: number;
}

export async function signTicket(
  claims: TicketClaims,
  key: Uint8Array,
  ttlSeconds = 30,
): Promise<string> {
  return new SignJWT({
    acc: claims.accountId,
    zone: claims.zoneId,
    srv: claims.targetServerId,
    party: claims.partyId,
    via: claims.via,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setSubject(claims.characterId)
    .setAudience(TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/**
 * Verifies signature, expiry and that the ticket was issued for this server.
 * Does NOT check replay; the caller must claim `ticketId` once.
 */
export async function verifyTicket(
  token: string,
  key: Uint8Array,
  expectedServerId: string,
): Promise<VerifiedTicket> {
  const p = await verify(token, key, TICKET_AUDIENCE);
  if (
    typeof p.jti !== "string" ||
    typeof p.sub !== "string" ||
    typeof p.acc !== "string" ||
    typeof p.zone !== "string" ||
    typeof p.srv !== "string" ||
    typeof p.exp !== "number"
  ) {
    throw new InvalidTokenError("invalid");
  }
  if (p.srv !== expectedServerId) {
    throw new InvalidTokenError("invalid");
  }
  const via = p.via as VerifiedTicket["via"];
  return {
    ticketId: p.jti,
    characterId: p.sub,
    accountId: p.acc,
    zoneId: p.zone,
    targetServerId: p.srv,
    partyId: typeof p.party === "string" ? p.party : undefined,
    via:
      via &&
      typeof via.sourceInstanceId === "string" &&
      typeof via.portalId === "string"
        ? via
        : undefined,
    expiresAt: p.exp * 1000,
  };
}
