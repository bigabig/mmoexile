import type { ProjectileState, DamageEvent } from "@mmoexile/shared";
import type {
  LootBagSpawnedEvent,
  LootBagDespawnedEvent,
  SnapshotEvent,
} from "../events/WorldEvents.js";

export interface EntityDeathRecord {
  entityId: string;
  isPlayer: boolean;
  killerId?: string;
}

export interface PlayerLevelUpRecord {
  playerId: string;
  playerName: string;
  newLevel: number;
}

export interface WorldTransferRecord {
  playerId: string;
  targetWorldId: string;
}

export interface WorldTickResult {
  worldId: string;
  tick: number;
  serverTime: number;
  snapshot?: SnapshotEvent;
  bullets: ProjectileState[];
  damageEvents: DamageEvent[];
  deaths: EntityDeathRecord[];
  levelUps: PlayerLevelUpRecord[];
  transfers: WorldTransferRecord[];
  lootBagsSpawned: LootBagSpawnedEvent[];
  lootBagsDespawned: LootBagDespawnedEvent[];
}

export class TickBuffer {
  public bullets: ProjectileState[] = [];
  public damageEvents: DamageEvent[] = [];
  public deaths: EntityDeathRecord[] = [];
  public levelUps: PlayerLevelUpRecord[] = [];
  public transfers: WorldTransferRecord[] = [];
  public lootBagsSpawned: LootBagSpawnedEvent[] = [];
  public lootBagsDespawned: LootBagDespawnedEvent[] = [];
  public snapshot?: SnapshotEvent;

  public clear(): void {
    this.bullets = [];
    this.damageEvents = [];
    this.deaths = [];
    this.levelUps = [];
    this.transfers = [];
    this.lootBagsSpawned = [];
    this.lootBagsDespawned = [];
    this.snapshot = undefined;
  }

  public toResult(
    worldId: string,
    tick: number,
    serverTime: number,
  ): WorldTickResult {
    const result: WorldTickResult = {
      worldId,
      tick,
      serverTime,
      snapshot: this.snapshot,
      bullets: [...this.bullets],
      damageEvents: [...this.damageEvents],
      deaths: [...this.deaths],
      levelUps: [...this.levelUps],
      transfers: [...this.transfers],
      lootBagsSpawned: [...this.lootBagsSpawned],
      lootBagsDespawned: [...this.lootBagsDespawned],
    };
    return result;
  }
}
