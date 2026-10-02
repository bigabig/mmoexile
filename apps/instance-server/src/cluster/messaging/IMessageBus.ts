import type { PlayerCommand, WorldTickResult } from "@mmoexile/simulation";
import type { MapData } from "@mmoexile/game-core";

export interface PlayerTransferPayload {
  playerId: string;
  targetInstanceId: string;
  mapData: MapData;
  spawnPoint: { x: number; y: number };
}

export interface ChatPayload {
  sender: string;
  text: string;
  kind: "system" | "player";
  targetInstanceId?: string;
}

export interface PlayerDeathPayload {
  playerId: string;
  charId: string;
  playerName: string;
  zoneName: string;
}

export interface IMessageBus {
  // Commands: Gateway -> Simulation
  publishCommand(playerId: string, command: PlayerCommand): void;
  onCommand(
    handler: (playerId: string, command: PlayerCommand) => void,
  ): () => void;

  // Tick Outputs: Simulation -> Gateway
  publishTickResult(
    instanceId: string,
    result: WorldTickResult,
    playerIds: ReadonlySet<string>,
  ): void;
  onTickResult(
    handler: (
      instanceId: string,
      result: WorldTickResult,
      playerIds: ReadonlySet<string>,
    ) => void,
  ): () => void;

  // Instance Transfer: Host -> Gateway
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

