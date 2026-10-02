import type { InstanceHost } from "../cluster/index.js";
import type { PartyService } from "../party/PartyService.js";

/**
 * Slash commands typed into chat. Replies go privately to the affected
 * players as system messages.
 */
export class ChatCommands {
  constructor(
    private readonly host: InstanceHost,
    private readonly parties: PartyService,
  ) {}

  /** Handles `text` if it is a command; returns false for normal chat. */
  public handle(playerId: string, text: string): boolean {
    if (!text.startsWith("/")) return false;
    const [command, ...args] = text.slice(1).trim().split(/\s+/);

    switch (command.toLowerCase()) {
      case "invite":
        this.invite(playerId, args.join(" "));
        break;
      case "accept":
        this.accept(playerId);
        break;
      case "leave":
        this.leave(playerId);
        break;
      case "party":
        this.list(playerId);
        break;
      default:
        this.tell(
          [playerId],
          `Unknown command /${command}. Try /invite <name>, /accept, /leave, /party.`,
        );
    }
    return true;
  }

  private invite(playerId: string, targetName: string): void {
    if (!targetName) {
      this.tell([playerId], "Usage: /invite <name>");
      return;
    }
    const targetId = this.host.findPlayerByName(targetName);
    if (!targetId) {
      this.tell([playerId], `No player named ${targetName} is online.`);
      return;
    }
    const result = this.parties.invite(playerId, targetId);
    if (!result.ok) {
      this.tell([playerId], result.reason);
      return;
    }
    this.tell([playerId], `Invited ${this.name(targetId)} to your party.`);
    this.tell(
      [targetId],
      `${this.name(playerId)} invited you to a party. Type /accept to join.`,
    );
  }

  private accept(playerId: string): void {
    const result = this.parties.accept(playerId);
    if (!result.ok) {
      this.tell([playerId], result.reason);
      return;
    }
    this.tell(
      result.party.members,
      `${this.name(playerId)} joined the party.`,
    );
  }

  private leave(playerId: string): void {
    const change = this.parties.leave(playerId);
    if (!change) {
      this.tell([playerId], "You are not in a party.");
      return;
    }
    this.tell([playerId], "You left the party.");
    if (change.party) {
      this.tell(change.party.members, `${this.name(playerId)} left the party.`);
    } else {
      const others = change.removed.filter((id) => id !== playerId);
      this.tell(others, "Your party was disbanded.");
    }
  }

  private list(playerId: string): void {
    const party = this.parties.getParty(playerId);
    if (!party) {
      this.tell([playerId], "You are not in a party. Use /invite <name>.");
      return;
    }
    const names = party.members.map(
      (id) => `${this.name(id)}${id === party.leaderId ? " (leader)" : ""}`,
    );
    this.tell([playerId], `Party (${names.length}/${this.parties.maxSize}): ${names.join(", ")}`);
  }

  private name(playerId: string): string {
    return this.host.getPlayerName(playerId) ?? "Someone";
  }

  private tell(playerIds: string[], text: string): void {
    if (playerIds.length === 0) return;
    this.host.messageBus.publishChat({
      sender: "Party",
      text,
      kind: "system",
      targetPlayerIds: playerIds,
    });
  }
}
