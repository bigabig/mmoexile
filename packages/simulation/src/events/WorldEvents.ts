import type { ProjectileState, DamageEvent } from "@mmoexile/game-core";
import type { EntityState } from "@mmoexile/protocol";

export interface PlayerPersistenceSnapshot {
  hp: number;
  mp?: number;
  level?: number;
  xp?: number;
  x: number;
  y: number;
  currentWorld: string;
  isAlive: boolean;
  deathReason?: string;
  equippedWeapon?: string | null;
  equippedArmor?: string | null;
  inventory?: string | (string | null)[];
}

export interface BulletSpawnedEvent {
  worldId: string;
  bullet: ProjectileState;
}

export interface DamageDealtEvent {
  worldId: string;
  event: DamageEvent;
}

export interface EntityDiedEvent {
  worldId: string;
  entityId: string;
  killerId?: string;
  isPlayer: boolean;
  killerName?: string;
}

export interface PlayerLevelUpEvent {
  playerId: string;
  playerName: string;
  newLevel: number;
}

export interface LootBagSpawnedEvent {
  worldId: string;
  bagId: string;
  x: number;
  y: number;
  kind: "bag_brown" | "bag_cyan";
  itemIds: string[];
}

export interface LootBagDespawnedEvent {
  worldId: string;
  bagId: string;
}

export interface WorldTransferRequestedEvent {
  playerId: string;
  targetWorldId: string;
}

export interface PlayerStatePersistEvent {
  playerId: string;
  state: PlayerPersistenceSnapshot;
}

export interface ChatBroadcastEvent {
  sender: string;
  text: string;
  kind: "system" | "player";
}

export interface SnapshotEvent {
  worldId: string;
  tick: number;
  serverTime: number;
  lastAckSeqs: Record<string, number>;
  entities: EntityState[];
  playerSnapshots?: Record<string, EntityState[]>;
  targetPlayerId?: string;
}

export interface WorldEventMap {
  bullet_spawned: BulletSpawnedEvent;
  damage_dealt: DamageDealtEvent;
  entity_died: EntityDiedEvent;
  player_level_up: PlayerLevelUpEvent;
  loot_bag_spawned: LootBagSpawnedEvent;
  loot_bag_despawned: LootBagDespawnedEvent;
  world_transfer_requested: WorldTransferRequestedEvent;
  player_state_persist: PlayerStatePersistEvent;
  chat_broadcast: ChatBroadcastEvent;
  snapshot: SnapshotEvent;
}
