import { randomUUID } from "node:crypto";
import {
  SignJWT,
  jwtVerify,
  errors,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  type CryptoKey,
} from "jose";

/**
 * Two kinds of signed tokens (JWT):
 * - Session token (HS256): "this is account X". Issued by account-api,
 *   verifiable by any service that knows the session secret.
 * - Transfer ticket (Ed25519): "character C may enter instance I on server
 *   S", valid for seconds. Required on every connection to an instance
 *   server. Only the orchestrator holds the private key; instance servers
 *   get the public key, so a compromised instance server cannot mint tickets.
 */

const MIN_SECRET_LENGTH = 32;

/**
 * Development-only signing secrets, so local setups need no configuration.
 * Services refuse to start with these when NODE_ENV=production.
 */
export const DEV_SESSION_SECRET = "dev-only-session-secret-do-not-use-in-prod";
/** Ed25519 key pair for tickets (base64 DER, the body of a PEM file). */
export const DEV_TICKET_PRIVATE_KEY =
  "MC4CAQAwBQYDK2VwBCIEIOf3DAcrV3OP8tN0pNxPDbeLrza0V9aFUx9hjcQY/BB5";
export const DEV_TICKET_PUBLIC_KEY =
  "MCowBQYDK2VwAyEARobAg+JoG5LFPbKJz6cA3+Rw5gvVIrSHYioptgJeAQY=";

const DEV_SECRETS = [DEV_SESSION_SECRET, DEV_TICKET_PRIVATE_KEY, DEV_TICKET_PUBLIC_KEY];

export function assertNotDevSecrets(
  nodeEnv: string,
  secrets: string[],
): void {
  if (nodeEnv === "production" && secrets.some((s) => DEV_SECRETS.includes(s))) {
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

const TICKET_ALG = "EdDSA";

/** An imported ticket key (private for signing, public for verifying). */
export type TicketKey = CryptoKey;

async function verify(
  token: string,
  key: Uint8Array | CryptoKey,
  audience: string,
  algorithm: string,
) {
  try {
    return (await jwtVerify(token, key, { audience, algorithms: [algorithm] }))
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
  const payload = await verify(token, key, SESSION_AUDIENCE, "HS256");
  if (typeof payload.sub !== "string" || typeof payload.name !== "string") {
    throw new InvalidTokenError("invalid");
  }
  return { accountId: payload.sub, nickname: payload.name };
}

// --- Transfer tickets ---

/** Accepts a PEM file's content, or just its base64 body (one line, env-friendly). */
function toPem(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = value.trim().replace(/\\n/g, "\n");
  if (trimmed.startsWith("-----BEGIN")) return trimmed;
  const body = trimmed.match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

/** The orchestrator's key for signing tickets. */
export function ticketSigningKey(privateKey: string): Promise<CryptoKey> {
  return importPKCS8(toPem(privateKey, "PRIVATE KEY"), TICKET_ALG);
}

/** The key instance servers verify tickets with. */
export function ticketVerificationKey(publicKey: string): Promise<CryptoKey> {
  return importSPKI(toPem(publicKey, "PUBLIC KEY"), TICKET_ALG);
}

/** A fresh key pair, as base64 bodies (see `pnpm --filter @mmoexile/auth keygen`). */
export async function generateTicketKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await generateKeyPair(TICKET_ALG, { extractable: true });
  const body = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  return {
    privateKey: body(await exportPKCS8(pair.privateKey)),
    publicKey: body(await exportSPKI(pair.publicKey)),
  };
}

export interface TicketClaims {
  characterId: string;
  accountId: string;
  /** Zone to enter on the target server. */
  zoneId: string;
  /** Instance the orchestrator chose; the server falls back to its own placement if unset. */
  instanceId?: string;
  /** Server the ticket is valid for; other servers must reject it. */
  targetServerId: string;
  partyId?: string;
  /** Portal used, for portal_bound zones. */
  via?: { sourceInstanceId: string; portalId: string };
}

export interface VerifiedTicket extends TicketClaims {
  /** Unique ticket ID; claim it once to prevent replays. */
  ticketId: string;
  /** When the orchestrator issued it (ms), e.g. to measure handoff time. */
  issuedAt: number;
  expiresAt: number;
}

export async function signTicket(
  claims: TicketClaims & { ticketId?: string },
  key: CryptoKey,
  ttlSeconds = 30,
): Promise<string> {
  return new SignJWT({
    acc: claims.accountId,
    zone: claims.zoneId,
    inst: claims.instanceId,
    srv: claims.targetServerId,
    party: claims.partyId,
    via: claims.via,
  })
    .setProtectedHeader({ alg: TICKET_ALG })
    .setJti(claims.ticketId ?? randomUUID())
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
  key: CryptoKey,
  expectedServerId: string,
): Promise<VerifiedTicket> {
  const p = await verify(token, key, TICKET_AUDIENCE, TICKET_ALG);
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
    instanceId: typeof p.inst === "string" ? p.inst : undefined,
    targetServerId: p.srv,
    partyId: typeof p.party === "string" ? p.party : undefined,
    via:
      via &&
      typeof via.sourceInstanceId === "string" &&
      typeof via.portalId === "string"
        ? via
        : undefined,
    issuedAt: (typeof p.iat === "number" ? p.iat : p.exp - 30) * 1000,
    expiresAt: p.exp * 1000,
  };
}
