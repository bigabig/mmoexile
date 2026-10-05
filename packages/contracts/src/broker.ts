import { z } from "zod";
import { PartySchema } from "./social.js";

/**
 * Messages exchanged between services over the broker (Redis pub/sub).
 * Delivery is fire-and-forget: a subscriber that is offline misses messages,
 * so nothing here may be the only copy of important state.
 */

const ChatMessage = z.object({
  senderName: z.string(),
  text: z.string(),
  kind: z.enum(["system", "player"]),
});

export const channels = {
  /** Player chat to everyone (/g) and global announcements (deaths). */
  chatGlobal: {
    name: "chat.global",
    schema: ChatMessage,
  },
  /** Party chat (/p) and party notices, delivered to the listed members. */
  chatParty: {
    name: "chat.party",
    schema: ChatMessage.extend({ memberIds: z.array(z.string()) }),
  },
  /** A party changed; servers forward s2c_party_update to affected players. */
  partyUpdated: {
    name: "party.updated",
    schema: z.object({
      partyId: z.string(),
      party: PartySchema.nullable(),
      removed: z.array(z.string()),
    }),
  },
  /** Disconnect this character wherever it is (e.g. it logged in elsewhere). */
  sessionKick: {
    name: "session.kick",
    schema: z.object({
      characterId: z.string(),
      reason: z.enum(["logged_in_elsewhere", "server_shutdown"]),
    }),
  },
} as const;

export type Channel = (typeof channels)[keyof typeof channels];
export type ChannelMessage<C extends Channel> = z.infer<C["schema"]>;
