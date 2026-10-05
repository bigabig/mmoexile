import type { PlayerCommand } from "./PlayerCommand.js";

export interface QueuedPlayerCommand {
  playerId: string;
  command: PlayerCommand;
}

export class CommandQueue {
  private queue: QueuedPlayerCommand[] = [];

  public enqueue(playerId: string, command: PlayerCommand): void {
    this.queue.push({ playerId, command });
  }

  public drain(): QueuedPlayerCommand[] {
    if (this.queue.length === 0) return [];
    const commands = this.queue;
    this.queue = [];
    return commands;
  }

  public clear(): void {
    this.queue = [];
  }
}

