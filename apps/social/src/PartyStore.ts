import { randomBytes } from "node:crypto";
import type { Redis } from "@mmoexile/messaging";
import {
  MAX_PARTY_SIZE,
  redisKeys,
  type Party,
  type PartyResult,
} from "@mmoexile/contracts";

export interface PartyChange {
  partyId: string;
  /** The party after the change; null if it was disbanded. */
  party: Party | null;
  /** Characters no longer in the party because of this change. */
  removed: string[];
}

/**
 * Parties stored in Redis (ephemeral: no database). All mutations run one
 * after another through an in-process queue; that is safe because Stage 2
 * runs a single social process. Scaling out would need Redis transactions.
 */
export class PartyStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly redis: Redis,
    private readonly onChange: (change: PartyChange) => Promise<void>,
    private readonly options: { maxSize?: number; inviteTtlMs?: number } = {},
  ) {}

  private get maxSize() {
    return this.options.maxSize ?? MAX_PARTY_SIZE;
  }

  /** Runs mutations strictly one after another. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async getParty(characterId: string): Promise<Party | null> {
    const partyId = await this.redis.get(redisKeys.partyOf(characterId));
    if (!partyId) return null;
    const raw = await this.redis.get(redisKeys.party(partyId));
    return raw ? (JSON.parse(raw) as Party) : null;
  }

  invite(inviterId: string, inviteeId: string): Promise<PartyResult> {
    return this.serialized(async () => {
      if (inviterId === inviteeId) {
        return { ok: false, reason: "You can't invite yourself." };
      }
      if (await this.redis.exists(redisKeys.partyOf(inviteeId))) {
        return { ok: false, reason: "That player is already in a party." };
      }
      const party = await this.getParty(inviterId);
      if (party && party.members.length >= this.maxSize) {
        return { ok: false, reason: `Your party is full (${this.maxSize}).` };
      }
      await this.redis.set(
        redisKeys.partyInvite(inviteeId),
        inviterId,
        "PX",
        this.options.inviteTtlMs ?? 60_000,
      );
      return { ok: true, party };
    });
  }

  accept(inviteeId: string): Promise<PartyResult> {
    return this.serialized(async () => {
      const inviterId = await this.redis.getdel(redisKeys.partyInvite(inviteeId));
      if (!inviterId) {
        return { ok: false, reason: "You have no pending party invite." };
      }
      if (await this.redis.exists(redisKeys.partyOf(inviteeId))) {
        return { ok: false, reason: "You are already in a party." };
      }

      let party = await this.getParty(inviterId);
      if (!party) {
        party = {
          id: `party_${randomBytes(4).toString("hex")}`,
          leaderId: inviterId,
          members: [inviterId],
        };
        await this.redis.set(redisKeys.partyOf(inviterId), party.id);
      }
      if (party.members.length >= this.maxSize) {
        return { ok: false, reason: "That party is full." };
      }

      party.members.push(inviteeId);
      await this.redis
        .multi()
        .set(redisKeys.party(party.id), JSON.stringify(party))
        .set(redisKeys.partyOf(inviteeId), party.id)
        .exec();
      await this.onChange({ partyId: party.id, party, removed: [] });
      return { ok: true, party };
    });
  }

  /** Leaves the current party; a party of one is disbanded. */
  leave(characterId: string): Promise<PartyResult> {
    return this.serialized(async () => {
      await this.redis.del(redisKeys.partyInvite(characterId));
      const party = await this.getParty(characterId);
      if (!party) return { ok: false, reason: "You are not in a party." };

      party.members = party.members.filter((id) => id !== characterId);
      let change: PartyChange;
      if (party.members.length <= 1) {
        await this.redis.del(
          redisKeys.party(party.id),
          redisKeys.partyOf(characterId),
          ...party.members.map((id) => redisKeys.partyOf(id)),
        );
        change = {
          partyId: party.id,
          party: null,
          removed: [characterId, ...party.members],
        };
      } else {
        if (party.leaderId === characterId) party.leaderId = party.members[0];
        await this.redis
          .multi()
          .set(redisKeys.party(party.id), JSON.stringify(party))
          .del(redisKeys.partyOf(characterId))
          .exec();
        change = { partyId: party.id, party, removed: [characterId] };
      }
      await this.onChange(change);
      return { ok: true, party: change.party };
    });
  }
}
