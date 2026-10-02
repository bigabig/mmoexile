import {
  ZONES,
  isZoneId,
  type MapData,
  type ZoneId,
  type CharacterData,
  Health,
  Progression,
  Equipment,
  Inventory,
  Identity,
} from "@mmoexile/game-core";
import {
  GameWorld,
  type WorldTickResult,
  type PlayerCommand,
  type SpawnPlayerOptions,
} from "@mmoexile/simulation";
import { InProcessWorldRunner } from "./runners/InProcessWorldRunner.js";
import {
  generateInstanceId,
  type Instance,
  type InstanceId,
} from "./Instance.js";
import {
  persistenceService,
  type CharacterUpdateState,
} from "../persistence/index.js";
import type { IMessageBus } from "./messaging/IMessageBus.js";
import { InMemoryMessageBus } from "./messaging/InMemoryMessageBus.js";

/** Character data accepted when a player joins (domain or raw DB shape). */
export type JoiningCharacter =
  | CharacterData
  | {
      class?: string;
      classId?: string;
      level?: number;
      xp?: number;
      hp?: number;
      mp?: number;
      equipment?: { weapon?: string | null; armor?: string | null };
      equippedWeapon?: string | null;
      equippedArmor?: string | null;
      inventory?: string | (string | null)[];
    };

export interface RegisterPlayerOptions {
  playerId: string;
  name: string;
  charId?: string;
  /** Zone to spawn in; unknown zones fall back to the nexus. */
  zoneId?: string;
  character?: JoiningCharacter;
}

export interface RegisteredPlayer {
  instanceId: InstanceId;
  zoneId: ZoneId;
  map: MapData;
  playerEid: number;
}

export interface InstanceHostOptions {
  messageBus?: IMessageBus;
  generateId?: (zoneId: ZoneId) => InstanceId;
  now?: () => number;
}

/**
 * Hosts many instances inside this process: creates them, routes players and
 * commands to them, moves players between them, and persists player state.
 */
export class InstanceHost {
  private instances = new Map<InstanceId, Instance>();
  private playerInstance = new Map<string, InstanceId>();
  private playerInfo = new Map<string, { name: string; charId: string }>();
  private readonly generateId: (zoneId: ZoneId) => InstanceId;
  private readonly now: () => number;
  public readonly messageBus: IMessageBus;

  constructor(options: InstanceHostOptions = {}) {
    this.messageBus = options.messageBus ?? new InMemoryMessageBus();
    this.generateId = options.generateId ?? generateInstanceId;
    this.now = options.now ?? Date.now;

    // One instance per zone at startup; on-demand placement arrives in S1.3.
    for (const zone of Object.values(ZONES)) {
      this.createInstance(zone.id);
    }

    this.messageBus.onCommand((playerId, command) => {
      this.forwardCommand(playerId, command);
    });
  }

  // --- Instances ---

  public createInstance(
    zoneId: ZoneId,
    options: { ownerPartyId?: string } = {},
  ): Instance {
    const zone = ZONES[zoneId];
    let id = this.generateId(zoneId);
    while (this.instances.has(id)) {
      id = this.generateId(zoneId);
    }

    const mapData = zone.createMap();
    const world = new GameWorld(id, mapData);
    const instance: Instance = {
      id,
      zone,
      world,
      mapData,
      runner: new InProcessWorldRunner(world, 30, (result) =>
        this.handleTick(instance, result),
      ),
      players: new Set(),
      ownerPartyId: options.ownerPartyId,
      state: "creating",
      createdAt: this.now(),
      emptySince: this.now(),
    };

    this.instances.set(id, instance);
    instance.runner.start();
    instance.state = "empty";
    return instance;
  }

  public getInstance(instanceId: InstanceId): Instance | undefined {
    return this.instances.get(instanceId);
  }

  public getInstancesForZone(zoneId: ZoneId): Instance[] {
    return [...this.instances.values()].filter((i) => i.zone.id === zoneId);
  }

  public getAllInstances(): Instance[] {
    return [...this.instances.values()];
  }

  public getInstanceForPlayer(playerId: string): Instance | undefined {
    const instanceId = this.playerInstance.get(playerId);
    return instanceId ? this.instances.get(instanceId) : undefined;
  }

  /**
   * Picks the instance a player should enter for a zone.
   * Temporary: the first instance of the zone, created if none exists.
   * Replaced by policy-based placement (InstanceManager) in S1.3.
   */
  private resolveInstance(zoneId: ZoneId): Instance {
    return this.getInstancesForZone(zoneId)[0] ?? this.createInstance(zoneId);
  }

  private addPlayerToInstance(instance: Instance, playerId: string): void {
    this.playerInstance.set(playerId, instance.id);
    instance.players.add(playerId);
    instance.state = "running";
    instance.emptySince = undefined;
  }

  private removePlayerFromInstance(instance: Instance, playerId: string): void {
    instance.players.delete(playerId);
    instance.world.removePlayer(playerId);
    if (instance.players.size === 0) {
      instance.state = "empty";
      instance.emptySince = this.now();
    }
  }

  // --- Tick output ---

  private handleTick(instance: Instance, result: WorldTickResult): void {
    // 1. Portal transfers requested this tick
    for (const transfer of result.transfers) {
      this.transferPlayer(transfer.playerId, transfer.targetZoneId);
    }

    // 2. Level ups
    for (const lvl of result.levelUps) {
      this.broadcastChat(
        "Level Up",
        `🎉 ${lvl.playerName} has reached Level ${lvl.newLevel}!`,
        "system",
      );
    }

    // 3. Deaths
    for (const death of result.deaths) {
      if (!death.isPlayer) continue;
      const info = this.playerInfo.get(death.entityId);
      if (!info) continue;
      persistenceService.handleDeath(info.charId);
      const zoneName = instance.mapData.name;
      this.broadcastChat(
        "Graveyard",
        `${info.name} was slain in ${zoneName}!`,
        "system",
      );
      this.messageBus.publishPlayerDeath({
        playerId: death.entityId,
        charId: info.charId,
        playerName: info.name,
        zoneName,
      });
    }

    // 4. Periodic player state persistence (every 150 ticks = 5 seconds)
    if (result.tick % 150 === 0) {
      for (const item of instance.world.getPlayerPersistenceStates()) {
        const info = this.playerInfo.get(item.playerId);
        if (info) {
          persistenceService.queueSave(info.charId, item.state);
        }
      }
    }

    // 5. Hand the tick output to the gateway
    this.messageBus.publishTickResult(instance.id, result, instance.players);
  }

  // --- Players ---

  public registerPlayer(options: RegisterPlayerOptions): RegisteredPlayer {
    const { playerId, name, character } = options;
    const charId = options.charId ?? playerId;
    this.playerInfo.set(playerId, { name, charId });

    const zoneId: ZoneId =
      options.zoneId && isZoneId(options.zoneId) ? options.zoneId : "nexus";
    const instance = this.resolveInstance(zoneId);
    this.addPlayerToInstance(instance, playerId);

    let inventory: (string | null)[] | undefined = undefined;
    if (character?.inventory) {
      if (Array.isArray(character.inventory)) {
        inventory = character.inventory;
      } else if (typeof character.inventory === "string") {
        try {
          inventory = JSON.parse(character.inventory);
        } catch {}
      }
    }

    const c = character as any;
    const classId = c?.classId || c?.class || "wizard";
    const weapon = c?.equipment ? c.equipment.weapon : c?.equippedWeapon;
    const armor = c?.equipment ? c.equipment.armor : c?.equippedArmor;

    const playerEid = instance.world.addPlayer({
      id: playerId,
      name,
      classId,
      level: character?.level || 1,
      xp: character?.xp || 0,
      hp: character?.hp,
      mp: character?.mp,
      x: instance.mapData.spawnPoint.x,
      y: instance.mapData.spawnPoint.y,
      equipment: { weapon, armor },
      inventory,
    });

    return {
      instanceId: instance.id,
      zoneId,
      map: instance.mapData,
      playerEid,
    };
  }

  public unregisterPlayer(playerId: string): CharacterUpdateState | undefined {
    const instance = this.getInstanceForPlayer(playerId);
    const info = this.playerInfo.get(playerId);
    let finalState: CharacterUpdateState | undefined = undefined;

    if (instance && info) {
      const state = instance.world.getPlayerPersistenceState(playerId);
      if (state) {
        finalState = state;
        persistenceService.saveImmediate(info.charId, state);
      }
      this.removePlayerFromInstance(instance, playerId);
    }

    this.playerInstance.delete(playerId);
    this.playerInfo.delete(playerId);
    return finalState;
  }

  /**
   * Moves a player into an instance of the target zone, preserving their
   * full session state.
   */
  public transferPlayer(playerId: string, targetZoneId: string): boolean {
    if (!isZoneId(targetZoneId)) return false;
    const source = this.getInstanceForPlayer(playerId);
    const info = this.playerInfo.get(playerId);
    if (!source || !info) return false;

    const target = this.resolveInstance(targetZoneId);
    if (target.id === source.id) return false;

    const eid = source.world.uuidToEid.get(playerId);
    if (eid === undefined) return false;

    // 1. Snapshot the player and remove them from the source instance
    const playerData: SpawnPlayerOptions = {
      id: playerId,
      name: Identity.name[eid],
      classId: Progression.classId[eid],
      level: Progression.level[eid],
      xp: Progression.xp[eid],
      hp: Health.current[eid],
      mp: 100,
      x: target.mapData.spawnPoint.x,
      y: target.mapData.spawnPoint.y,
      equipment: {
        weapon: Equipment.weapon[eid],
        armor: Equipment.armor[eid],
      },
      inventory: [...(Inventory.slots[eid] || new Array(8).fill(null))],
    };
    this.removePlayerFromInstance(source, playerId);

    // 2. Spawn them in the target instance
    this.addPlayerToInstance(target, playerId);
    target.world.addPlayer(playerData);

    // 3. Tell the gateway
    this.messageBus.publishPlayerTransfer({
      playerId,
      targetInstanceId: target.id,
      mapData: target.mapData,
      spawnPoint: target.mapData.spawnPoint,
    });

    this.broadcastChat(
      "System",
      `${info.name} entered ${target.mapData.name}`,
      "system",
    );
    return true;
  }

  // --- Commands ---

  public forwardCommand(playerId: string, command: PlayerCommand): void {
    this.getInstanceForPlayer(playerId)?.world.enqueueCommand(
      playerId,
      command,
    );
  }

  public forwardInput(
    playerId: string,
    seq: number,
    moveX: number,
    moveY: number,
    angle: number,
    dt: number,
  ): void {
    this.forwardCommand(playerId, {
      type: "move",
      seq,
      moveX,
      moveY,
      angle,
      dt,
    });
  }

  public forwardShoot(playerId: string, angle: number): void {
    this.forwardCommand(playerId, { type: "shoot", angle });
  }

  public forwardInteract(playerId: string): void {
    this.forwardCommand(playerId, { type: "interact" });
  }

  public forwardLootItem(
    playerId: string,
    bagId: string,
    itemIndex?: number,
  ): void {
    this.forwardCommand(playerId, { type: "loot_item", bagId, itemIndex });
  }

  public forwardLootAll(playerId: string, bagId: string): void {
    this.forwardCommand(playerId, { type: "loot_all", bagId });
  }

  public forwardEquipItem(
    playerId: string,
    inventoryIndex: number,
    slot: "weapon" | "armor",
  ): void {
    this.forwardCommand(playerId, {
      type: "equip_item",
      inventoryIndex,
      slot,
    });
  }

  public forwardUnequipItem(
    playerId: string,
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ): void {
    this.forwardCommand(playerId, {
      type: "unequip_item",
      slot,
      targetInventoryIndex,
    });
  }

  public forwardSwapInventorySlots(
    playerId: string,
    fromIndex: number,
    toIndex: number,
  ): void {
    this.forwardCommand(playerId, { type: "swap_slots", fromIndex, toIndex });
  }

  public forwardDropItem(
    playerId: string,
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ): void {
    this.forwardCommand(playerId, {
      type: "drop_item",
      fromSlot,
      inventoryIndex,
    });
  }

  // --- Chat ---

  public broadcastChat(
    sender: string,
    text: string,
    kind: "system" | "player" = "player",
    targetInstanceId?: InstanceId,
  ): void {
    this.messageBus.publishChat({ sender, text, kind, targetInstanceId });
  }

  // --- Shutdown ---

  public prepareShutdown(): void {
    // 1. Stop all runners to freeze simulation state
    for (const instance of this.instances.values()) {
      instance.runner.stop();
    }

    // 2. Queue final snapshots of all active players
    for (const instance of this.instances.values()) {
      for (const item of instance.world.getPlayerPersistenceStates()) {
        const info = this.playerInfo.get(item.playerId);
        if (info) {
          persistenceService.queueSave(info.charId, item.state);
        }
      }
    }
  }

  public stop(): void {
    for (const instance of this.instances.values()) {
      instance.runner.stop();
      instance.world.destroy();
      instance.state = "closed";
    }
    this.instances.clear();
    this.playerInstance.clear();
    this.playerInfo.clear();
  }
}
