import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A random, URL-safe secret (e.g. a refresh secret handed to the client). */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * One-way hash for storing secrets. The database only ever sees the hash, so
 * a leaked table does not leak working credentials.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatchesHash(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
