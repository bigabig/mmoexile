import { channels, type ChannelMessage, type Party } from "@mmoexile/contracts";
import type { Broker } from "@mmoexile/messaging";

export type PartyUpdate = ChannelMessage<typeof channels.partyUpdated>;

/**
 * Local view of party membership, kept current by `party.updated` messages.
 * Placement reads it synchronously, so a transfer never waits on the network.
 */
export class PartyCache {
  private partyOf = new Map<string, string>();
  private parties = new Map<string, Party>();
  private listeners: ((update: PartyUpdate) => void)[] = [];

  constructor(private readonly broker: Broker) {}

  async start(): Promise<void> {
    await this.broker.subscribe(channels.partyUpdated, (update) =>
      this.apply(update),
    );
  }

  onUpdate(listener: (update: PartyUpdate) => void): void {
    this.listeners.push(listener);
  }

  /** Seeds the cache for a character that just arrived on this server. */
  seed(characterId: string, party: Party | null): void {
    if (party) {
      this.parties.set(party.id, party);
      for (const member of party.members) this.partyOf.set(member, party.id);
    } else {
      this.partyOf.delete(characterId);
    }
  }

  getPartyId(characterId: string): string | undefined {
    return this.partyOf.get(characterId);
  }

  getParty(characterId: string): Party | undefined {
    const id = this.partyOf.get(characterId);
    return id ? this.parties.get(id) : undefined;
  }

  private apply(update: PartyUpdate): void {
    for (const removed of update.removed) {
      if (this.partyOf.get(removed) === update.partyId) {
        this.partyOf.delete(removed);
      }
    }
    if (update.party) {
      this.parties.set(update.partyId, update.party);
      for (const member of update.party.members) {
        this.partyOf.set(member, update.partyId);
      }
    } else {
      this.parties.delete(update.partyId);
    }
    for (const listener of this.listeners) listener(update);
  }
}
