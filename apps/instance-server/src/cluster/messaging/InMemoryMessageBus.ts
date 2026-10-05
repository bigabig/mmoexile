import type {
  IMessageBus,
  PlayerTransferPayload,
  ChatPayload,
  PlayerDeathPayload,
} from "./IMessageBus.js";
import type { PlayerCommand, WorldTickResult } from "@mmoexile/simulation";

export class InMemoryMessageBus implements IMessageBus {
  private commandHandlers: ((
    playerId: string,
    command: PlayerCommand,
  ) => void)[] = [];
  private tickHandlers: ((
    instanceId: string,
    result: WorldTickResult,
    playerIds: ReadonlySet<string>,
  ) => void)[] = [];
  private transferHandlers: ((payload: PlayerTransferPayload) => void)[] = [];
  private chatHandlers: ((payload: ChatPayload) => void)[] = [];
  private deathHandlers: ((payload: PlayerDeathPayload) => void)[] = [];

  public publishCommand(playerId: string, command: PlayerCommand): void {
    for (const handler of this.commandHandlers) {
      try {
        handler(playerId, command);
      } catch (err) {
        console.error("[InMemoryMessageBus] Error in command handler:", err);
      }
    }
  }

  public onCommand(
    handler: (playerId: string, command: PlayerCommand) => void,
  ): () => void {
    this.commandHandlers.push(handler);
    return () => {
      this.commandHandlers = this.commandHandlers.filter((h) => h !== handler);
    };
  }

  public publishTickResult(
    instanceId: string,
    result: WorldTickResult,
    playerIds: ReadonlySet<string>,
  ): void {
    for (const handler of this.tickHandlers) {
      try {
        handler(instanceId, result, playerIds);
      } catch (err) {
        console.error("[InMemoryMessageBus] Error in tick handler:", err);
      }
    }
  }

  public onTickResult(
    handler: (
      instanceId: string,
      result: WorldTickResult,
      playerIds: ReadonlySet<string>,
    ) => void,
  ): () => void {
    this.tickHandlers.push(handler);
    return () => {
      this.tickHandlers = this.tickHandlers.filter((h) => h !== handler);
    };
  }

  public publishPlayerTransfer(payload: PlayerTransferPayload): void {
    for (const handler of this.transferHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error("[InMemoryMessageBus] Error in transfer handler:", err);
      }
    }
  }

  public onPlayerTransfer(
    handler: (payload: PlayerTransferPayload) => void,
  ): () => void {
    this.transferHandlers.push(handler);
    return () => {
      this.transferHandlers = this.transferHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  public publishChat(payload: ChatPayload): void {
    for (const handler of this.chatHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error("[InMemoryMessageBus] Error in chat handler:", err);
      }
    }
  }

  public onChat(handler: (payload: ChatPayload) => void): () => void {
    this.chatHandlers.push(handler);
    return () => {
      this.chatHandlers = this.chatHandlers.filter((h) => h !== handler);
    };
  }

  public publishPlayerDeath(payload: PlayerDeathPayload): void {
    for (const handler of this.deathHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error("[InMemoryMessageBus] Error in death handler:", err);
      }
    }
  }

  public onPlayerDeath(
    handler: (payload: PlayerDeathPayload) => void,
  ): () => void {
    this.deathHandlers.push(handler);
    return () => {
      this.deathHandlers = this.deathHandlers.filter((h) => h !== handler);
    };
  }
}

