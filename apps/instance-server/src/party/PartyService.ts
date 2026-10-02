import { randomBytes } from "crypto";

export interface Party {
  readonly id: string;
  leaderId: string;
  /** Character IDs in join order. */
  readonly members: string[];
}

export interface PartyChange {
  /** The party after the change; null if it was disbanded. */
  party: Party | null;
  partyId: string;
  /** Characters no longer in the party because of this change. */
  removed: string[];
}

export type PartyResult =
  | { ok: true; party: Party }
  | { ok: false; reason: string };

interface PendingInvite {
  inviterId: string;
  expiresAt: number;
}

export interface PartyServiceOptions {
  maxSize?: number;
  inviteTtlMs?: number;
  now?: () => number;
}

/**
 * In-process party registry. Parties own private instances (see
 * InstanceManager). Moves to the `social` app in Stage 2.
 */
export class PartyService {
  public readonly maxSize: number;
  private readonly inviteTtlMs: number;
  private readonly now: () => number;
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, string>();
  private invites = new Map<string, PendingInvite>();
  private listeners: ((change: PartyChange) => void)[] = [];

  constructor(options: PartyServiceOptions = {}) {
    this.maxSize = options.maxSize ?? 6;
    this.inviteTtlMs = options.inviteTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  public onChange(listener: (change: PartyChange) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getPartyId(characterId: string): string | undefined {
    return this.partyOf.get(characterId);
  }

  public getParty(characterId: string): Party | undefined {
    const partyId = this.partyOf.get(characterId);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  public invite(
    inviterId: string,
    inviteeId: string,
  ): { ok: true } | { ok: false; reason: string } {
    if (inviterId === inviteeId) {
      return { ok: false, reason: "You can't invite yourself." };
    }
    if (this.partyOf.has(inviteeId)) {
      return { ok: false, reason: "That player is already in a party." };
    }
    const party = this.getParty(inviterId);
    if (party && party.members.length >= this.maxSize) {
      return { ok: false, reason: `Your party is full (${this.maxSize}).` };
    }
    this.invites.set(inviteeId, {
      inviterId,
      expiresAt: this.now() + this.inviteTtlMs,
    });
    return { ok: true };
  }

  /** The inviter of a pending, unexpired invite for this character. */
  public pendingInviter(inviteeId: string): string | undefined {
    const invite = this.invites.get(inviteeId);
    if (!invite || invite.expiresAt <= this.now()) return undefined;
    return invite.inviterId;
  }

  public accept(inviteeId: string): PartyResult {
    const inviterId = this.pendingInviter(inviteeId);
    this.invites.delete(inviteeId);
    if (!inviterId) {
      return { ok: false, reason: "You have no pending party invite." };
    }
    if (this.partyOf.has(inviteeId)) {
      return { ok: false, reason: "You are already in a party." };
    }

    let party = this.getParty(inviterId);
    if (!party) {
      party = {
        id: `party_${randomBytes(4).toString("hex")}`,
        leaderId: inviterId,
        members: [inviterId],
      };
      this.parties.set(party.id, party);
      this.partyOf.set(inviterId, party.id);
    }
    if (party.members.length >= this.maxSize) {
      return { ok: false, reason: "That party is full." };
    }

    party.members.push(inviteeId);
    this.partyOf.set(inviteeId, party.id);
    this.emit({ party, partyId: party.id, removed: [] });
    return { ok: true, party };
  }

  /** Leaves the current party; a party of one is disbanded. */
  public leave(characterId: string): PartyChange | undefined {
    this.invites.delete(characterId);
    const party = this.getParty(characterId);
    if (!party) return undefined;

    party.members.splice(party.members.indexOf(characterId), 1);
    this.partyOf.delete(characterId);
    let change: PartyChange;

    if (party.members.length <= 1) {
      // Nobody left to party with: disband.
      for (const remaining of party.members) {
        this.partyOf.delete(remaining);
      }
      this.parties.delete(party.id);
      change = {
        party: null,
        partyId: party.id,
        removed: [characterId, ...party.members],
      };
    } else {
      if (party.leaderId === characterId) {
        party.leaderId = party.members[0];
      }
      change = { party, partyId: party.id, removed: [characterId] };
    }

    this.emit(change);
    return change;
  }

  private emit(change: PartyChange): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}
