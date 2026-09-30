import type { PlayerCommand, WorldTickResult } from "../../simulation/index.js";
import type { MapData } from "@mmoexile/shared";

export interface PlayerTransferPayload {
  playerId: string;
  targetWorldId: string;
  mapData: MapData;
  spawnPoint: { x: number; y: number };
}

export interface ChatPayload {
  sender: string;
  text: string;
  kind: "system" | "player";
  targetWorldId?: string;
}

export interface PlayerDeathPayload {
  playerId: string;
  charId: string;
  playerName: string;
  worldName: string;
}

export interface IMessageBus {
  // Commands: Gateway -> Simulation
  publishCommand(playerId: string, command: PlayerCommand): void;
  onCommand(
    handler: (playerId: string, command: PlayerCommand) => void,
  ): () => void;

  // Tick Outputs: Simulation -> Gateway
  publishTickResult(
    worldId: string,
    result: WorldTickResult,
    playerIds: ReadonlySet<string>,
  ): void;
  onTickResult(
    handler: (
      worldId: string,
      result: WorldTickResult,
      playerIds: ReadonlySet<string>,
    ) => void,
  ): () => void;

  // World Transfer: Cluster -> Gateway
  publishPlayerTransfer(payload: PlayerTransferPayload): void;
  onPlayerTransfer(
    handler: (payload: PlayerTransferPayload) => void,
  ): () => void;

  // Chat: Gateway / Cluster -> Gateway / Clients
  publishChat(payload: ChatPayload): void;
  onChat(handler: (payload: ChatPayload) => void): () => void;

  // Death notifications: Cluster -> Gateway / Persistence
  publishPlayerDeath(payload: PlayerDeathPayload): void;
  onPlayerDeath(handler: (payload: PlayerDeathPayload) => void): () => void;
}

