/**
 * Redis key layout shared by the services. Keeping it in one place means
 * every service agrees on names and nobody invents a colliding key.
 */
export const redisKeys = {
  /** Which server/instance currently owns a character (with fencing epoch). */
  lease: (characterId: string) => `lease:char:${characterId}`,
  /** Marks a transfer ticket as used, so it can't be replayed. */
  usedTicket: (ticketId: string) => `ticket:used:${ticketId}`,
  /** Where an online character is: server, instance, zone, name. */
  presence: (characterId: string) => `presence:char:${characterId}`,
  /** Online character by lower-cased name, for /invite <name>. */
  presenceByName: (name: string) => `presence:name:${name.toLowerCase()}`,
  party: (partyId: string) => `party:${partyId}`,
  partyOf: (characterId: string) => `party:of:${characterId}`,
  partyInvite: (inviteeId: string) => `party:invite:${inviteeId}`,
} as const;
