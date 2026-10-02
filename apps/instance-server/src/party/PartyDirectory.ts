import { randomBytes } from "node:crypto";
import {
  channels,
  createHttpClient,
  MAX_PARTY_SIZE,
  socialApi,
  type Party,
  type PartyResult,
} from "@mmoexile/contracts";
import type { Broker } from "@mmoexile/messaging";

/**
 * Party operations. In production they go to the social service; party
 * changes then arrive as `party.updated` broker messages (see PartyCache).
 */
export interface PartyDirectory {
  invite(inviterId: string, inviteeId: string): Promise<PartyResult>;
  accept(characterId: string): Promise<PartyResult>;
  leave(characterId: string): Promise<PartyResult>;
  getParty(characterId: string): Promise<Party | null>;
}

/** Calls apps/social over HTTP. */
export class SocialPartyDirectory implements PartyDirectory {
  private readonly call;

  constructor(baseUrl: string) {
    this.call = createHttpClient({ baseUrl });
  }

  invite(inviterId: string, inviteeId: string) {
    return this.call(socialApi.invite, { inviterId, inviteeId });
  }
  accept(characterId: string) {
    return this.call(socialApi.accept, { characterId });
  }
  leave(characterId: string) {
    return this.call(socialApi.leave, { characterId });
  }
  async getParty(characterId: string) {
    return (await this.call(socialApi.getParty, { characterId })).party;
  }
}

/**
 * Same rules as the social service, in memory, publishing `party.updated`
 * to a broker. For tests and single-process setups.
 */
export class InMemoryPartyDirectory implements PartyDirectory {
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, string>();
  private invites = new Map<string, { inviterId: string; expiresAt: number }>();

  constructor(
    private readonly broker: Broker,
    private readonly options: { now?: () => number; inviteTtlMs?: number } = {},
  ) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  async getParty(characterId: string): Promise<Party | null> {
    const id = this.partyOf.get(characterId);
    const party = id ? this.parties.get(id) : undefined;
    return party ? structuredClone(party) : null;
  }

  async invite(inviterId: string, inviteeId: string): Promise<PartyResult> {
    if (inviterId === inviteeId) {
      return { ok: false, reason: "You can't invite yourself." };
    }
    if (this.partyOf.has(inviteeId)) {
      return { ok: false, reason: "That player is already in a party." };
    }
    const party = await this.getParty(inviterId);
    if (party && party.members.length >= MAX_PARTY_SIZE) {
      return { ok: false, reason: `Your party is full (${MAX_PARTY_SIZE}).` };
    }
    this.invites.set(inviteeId, {
      inviterId,
      expiresAt: this.now() + (this.options.inviteTtlMs ?? 60_000),
    });
    return { ok: true, party };
  }

  async accept(inviteeId: string): Promise<PartyResult> {
    const invite = this.invites.get(inviteeId);
    this.invites.delete(inviteeId);
    if (!invite || invite.expiresAt <= this.now()) {
      return { ok: false, reason: "You have no pending party invite." };
    }
    if (this.partyOf.has(inviteeId)) {
      return { ok: false, reason: "You are already in a party." };
    }
    const id = this.partyOf.get(invite.inviterId);
    let party = id ? this.parties.get(id) : undefined;
    if (!party) {
      party = {
        id: `party_${randomBytes(4).toString("hex")}`,
        leaderId: invite.inviterId,
        members: [invite.inviterId],
      };
      this.parties.set(party.id, party);
      this.partyOf.set(invite.inviterId, party.id);
    }
    if (party.members.length >= MAX_PARTY_SIZE) {
      return { ok: false, reason: "That party is full." };
    }
    party.members.push(inviteeId);
    this.partyOf.set(inviteeId, party.id);
    await this.broker.publish(channels.partyUpdated, {
      partyId: party.id,
      party,
      removed: [],
    });
    return { ok: true, party: structuredClone(party) };
  }

  async leave(characterId: string): Promise<PartyResult> {
    this.invites.delete(characterId);
    const id = this.partyOf.get(characterId);
    const party = id ? this.parties.get(id) : undefined;
    if (!party) return { ok: false, reason: "You are not in a party." };
    party.members = party.members.filter((m) => m !== characterId);
    this.partyOf.delete(characterId);
    if (party.members.length <= 1) {
      for (const m of party.members) this.partyOf.delete(m);
      this.parties.delete(party.id);
      await this.broker.publish(channels.partyUpdated, {
        partyId: party.id,
        party: null,
        removed: [characterId, ...party.members],
      });
      return { ok: true, party: null };
    }
    if (party.leaderId === characterId) party.leaderId = party.members[0];
    await this.broker.publish(channels.partyUpdated, {
      partyId: party.id,
      party,
      removed: [characterId],
    });
    return { ok: true, party: structuredClone(party) };
  }
}
