import { channels, MAX_PARTY_SIZE } from "@mmoexile/contracts";
import type { Broker } from "@mmoexile/messaging";
import type { InstanceHost } from "../cluster/index.js";
import type { PartyDirectory } from "../party/PartyDirectory.js";
import type { Presence } from "../presence/Presence.js";

export interface ChatCommandDeps {
  host: InstanceHost;
  parties: PartyDirectory;
  presence: Presence;
  broker: Broker;
  onError?: (err: unknown) => void;
}

/**
 * Slash commands typed into chat. Replies to the issuer stay on this server;
 * notices for other players go through the broker (`chat.party`), since they
 * may be connected to another instance server.
 */
export class ChatCommands {
  constructor(private readonly deps: ChatCommandDeps) {}

  /**
   * Handles `text` if it is a command (returns true right away; the command
   * itself runs asynchronously). Returns false for normal chat.
   */
  public handle(playerId: string, text: string): boolean {
    if (!text.startsWith("/")) return false;
    void this.run(playerId, text).catch((err) => {
      this.deps.onError?.(err);
      this.tell(playerId, "That didn't work. Please try again in a moment.");
    });
    return true;
  }

  /** Runs a command to completion (used directly by tests). */
  public async run(playerId: string, text: string): Promise<void> {
    const [command, ...args] = text.slice(1).trim().split(/\s+/);
    switch (command.toLowerCase()) {
      case "invite":
        return this.invite(playerId, args.join(" "));
      case "accept":
        return this.accept(playerId);
      case "leave":
        return this.leave(playerId);
      case "party":
        return this.list(playerId);
      case "g":
        return this.sayGlobal(playerId, args.join(" "));
      case "p":
        return this.sayParty(playerId, args.join(" "));
      default:
        this.tell(
          playerId,
          `Unknown command /${command}. Try /g <text>, /p <text>, /invite <name>, /accept, /leave, /party.`,
        );
    }
  }

  private async invite(playerId: string, targetName: string): Promise<void> {
    if (!targetName) return this.tell(playerId, "Usage: /invite <name>");
    const targetId = await this.deps.presence.findByName(targetName);
    if (!targetId) {
      return this.tell(playerId, `No player named ${targetName} is online.`);
    }
    const result = await this.deps.parties.invite(playerId, targetId);
    if (!result.ok) return this.tell(playerId, result.reason);
    const [me, them] = [this.name(playerId), await this.nameOf(targetId)];
    this.tell(playerId, `Invited ${them} to your party.`);
    await this.notify(
      [targetId],
      `${me} invited you to a party. Type /accept to join.`,
    );
  }

  private async accept(playerId: string): Promise<void> {
    const result = await this.deps.parties.accept(playerId);
    if (!result.ok) return this.tell(playerId, result.reason);
    if (result.party) {
      await this.notify(
        result.party.members,
        `${this.name(playerId)} joined the party.`,
      );
    }
  }

  private async leave(playerId: string): Promise<void> {
    const before = await this.deps.parties.getParty(playerId);
    const result = await this.deps.parties.leave(playerId);
    if (!result.ok) return this.tell(playerId, result.reason);
    this.tell(playerId, "You left the party.");
    const others = (before?.members ?? []).filter((id) => id !== playerId);
    await this.notify(
      others,
      result.party
        ? `${this.name(playerId)} left the party.`
        : "Your party was disbanded.",
    );
  }

  private async list(playerId: string): Promise<void> {
    const party = await this.deps.parties.getParty(playerId);
    if (!party) {
      return this.tell(playerId, "You are not in a party. Use /invite <name>.");
    }
    const names = await Promise.all(
      party.members.map(
        async (id) =>
          `${await this.nameOf(id)}${id === party.leaderId ? " (leader)" : ""}`,
      ),
    );
    this.tell(
      playerId,
      `Party (${names.length}/${MAX_PARTY_SIZE}): ${names.join(", ")}`,
    );
  }

  private async sayGlobal(playerId: string, text: string): Promise<void> {
    if (!text) return;
    await this.deps.broker.publish(channels.chatGlobal, {
      senderName: this.name(playerId),
      text,
      kind: "player",
    });
  }

  private async sayParty(playerId: string, text: string): Promise<void> {
    if (!text) return;
    const party = await this.deps.parties.getParty(playerId);
    if (!party) return this.tell(playerId, "You are not in a party.");
    await this.deps.broker.publish(channels.chatParty, {
      senderName: this.name(playerId),
      text,
      kind: "player",
      memberIds: party.members,
    });
  }

  private name(playerId: string): string {
    return this.deps.host.getPlayerName(playerId) ?? "Someone";
  }

  private async nameOf(characterId: string): Promise<string> {
    return (
      this.deps.host.getPlayerName(characterId) ??
      (await this.deps.presence.nameOf(characterId)) ??
      "Someone"
    );
  }

  /** Private reply to a player on this server. */
  private tell(playerId: string, text: string): void {
    this.deps.host.messageBus.publishChat({
      sender: "System",
      text,
      kind: "system",
      channel: "local",
      targetPlayerIds: [playerId],
    });
  }

  /** Party notice to players on any server. */
  private async notify(playerIds: string[], text: string): Promise<void> {
    if (playerIds.length === 0) return;
    await this.deps.broker.publish(channels.chatParty, {
      senderName: "Party",
      text,
      kind: "system",
      memberIds: playerIds,
    });
  }
}
