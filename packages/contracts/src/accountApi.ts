import { z } from "zod";

/**
 * HTTP API of apps/account-api. Called by the game client (login, character
 * select) and owns the Account and Character tables.
 */

export const CharacterClassId = z.enum(["wizard", "knight"]);

export const CharacterSummary = z.object({
  id: z.string(),
  classId: CharacterClassId,
  level: z.number().int(),
  xp: z.number().int(),
  isAlive: z.boolean(),
  lastZoneId: z.string(),
  createdAt: z.string(),
});
export type CharacterSummary = z.infer<typeof CharacterSummary>;

/** Living characters an account may have at once. */
export const MAX_CHARACTERS_PER_ACCOUNT = 8;

export const accountApi = {
  /** Creates a guest account. The refresh secret is the client's long-lived credential. */
  guestLogin: {
    method: "POST",
    path: "/auth/guest",
    body: z.object({ nickname: z.string().trim().min(1).max(16) }),
    response: z.object({
      accountId: z.string(),
      nickname: z.string(),
      sessionToken: z.string(),
      refreshSecret: z.string(),
    }),
  },
  /** Exchanges the refresh secret for a fresh session token. */
  refresh: {
    method: "POST",
    path: "/auth/refresh",
    body: z.object({ refreshSecret: z.string().min(1) }),
    response: z.object({
      accountId: z.string(),
      nickname: z.string(),
      sessionToken: z.string(),
    }),
  },
  listCharacters: {
    method: "GET",
    path: "/characters",
    body: z.undefined(),
    response: z.object({ characters: z.array(CharacterSummary) }),
  },
  createCharacter: {
    method: "POST",
    path: "/characters",
    body: z.object({ classId: CharacterClassId }),
    response: z.object({ character: CharacterSummary }),
  },
  /** Deletes one of the account's characters. Path: /characters/<id>. */
  deleteCharacter: {
    method: "DELETE",
    path: "/characters/:id",
    body: z.undefined(),
    response: z.object({ deleted: z.literal(true) }),
  },
  /** Starts playing a character: returns where to connect and a transfer ticket. */
  play: {
    method: "POST",
    path: "/play",
    body: z.object({ characterId: z.string() }),
    response: z.object({ url: z.string(), ticket: z.string() }),
  },
} as const;

/** Error body returned by every service for 4xx/5xx responses. */
export const ErrorResponse = z.object({
  error: z.string(),
  /** Machine-readable cause, where the client reacts to it (e.g. "region_unavailable"). */
  reason: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
