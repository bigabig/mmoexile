import { z } from "zod";

/**
 * HTTP API of apps/social. Called by instance servers when players use party
 * chat commands; the client never talks to social directly.
 */

export const PartySchema = z.object({
  id: z.string(),
  leaderId: z.string(),
  /** Character IDs in join order. */
  members: z.array(z.string()),
});
export type Party = z.infer<typeof PartySchema>;

/** Outcome of a party command: the party after it, or why it failed. */
export const PartyResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), party: PartySchema.nullable() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type PartyResult = z.infer<typeof PartyResult>;

export const MAX_PARTY_SIZE = 6;

export const socialApi = {
  invite: {
    method: "POST",
    path: "/parties/invite",
    body: z.object({ inviterId: z.string(), inviteeId: z.string() }),
    response: PartyResult,
  },
  accept: {
    method: "POST",
    path: "/parties/accept",
    body: z.object({ characterId: z.string() }),
    response: PartyResult,
  },
  leave: {
    method: "POST",
    path: "/parties/leave",
    body: z.object({ characterId: z.string() }),
    response: PartyResult,
  },
  getParty: {
    method: "POST",
    path: "/parties/of",
    body: z.object({ characterId: z.string() }),
    response: z.object({ party: PartySchema.nullable() }),
  },
} as const;
