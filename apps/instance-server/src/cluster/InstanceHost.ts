import {
  ZONES,
  isZoneId,
  type MapData,
  type ZoneId,
  type CharacterData,
} from "@mmoexile/game-core";
import {
  GameWorld,
  snapshotCharacter,
  spawnOptionsFromSnapshot,
  type WorldTickResult,
  type PlayerCommand,
} from "@mmoexile/simulation";
import { InProcessWorldRunner } from "./runners/InProcessWorldRunner.js";
import {
  generateInstanceId,
  type Instance,
  type InstanceId,
} from "./Instance.js";
import {
  InstanceManager,
  type CreateInstanceOptions,
  type InstanceDirectory,
  type InstancePool,
} from "./InstanceManager.js";
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
  /** How often idle instances are checked for closing; 0 disables the timer. */
  sweepIntervalMs?: number;
  /** Placement policy; defaults to the zone access rules (InstanceManager). */
  placement?: InstanceDirectory;
  /** Looks up a character's party, so party members share private instances. */
  getPartyId?: (characterId: string) => string | undefined;
  generateId?: (zoneId: ZoneId) => InstanceId;
  now?: () => number;
}

/**
 * Hosts many instances inside this process: creates them, routes players and
 * commands to them, moves players between them, and persists player state.
 */
export class InstanceHost implements InstancePool {
  private instances = new Map<InstanceId, Instance>();
  private playerInstance = new Map<string, InstanceId>();
  private playerInfo = new Map<string, { name: string; charId: string }>();
  private readonly generateId: (zoneId: ZoneId) => InstanceId;
  private readonly now: () => number;
  private readonly placement: InstanceDirectory;
  private readonly getPartyId: (characterId: string) => string | undefined;
  private sweepTimer: NodeJS.Timeout | null = null;
  public readonly messageBus: IMessageBus;

  constructor(options: InstanceHostOptions = {}) {
    this.messageBus = options.messageBus ?? new InMemoryMessageBus();
    this.generateId = options.generateId ?? generateInstanceId;
    this.now = options.now ?? Date.now;
    this.placement = options.placement ?? new InstanceManager(this);
    this.getPartyId = options.getPartyId ?? (() => undefined);

    // Keep warm instances (e.g. one nexus) ready; everything else is created
    // on demand by the placement policy.
    for (const zone of Object.values(ZONES)) {
      for (let i = 0; i < (zone.minWarmInstances ?? 0); i++) {
        this.createInstance(zone.id);
      }
    }

    this.messageBus.onCommand((playerId, command) => {
      this.forwardCommand(playerId, command);
    });

    // Lifecycle sweeper: runs outside every tick loop.
    const sweepIntervalMs = options.sweepIntervalMs ?? 1000;
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(
        () => this.sweepIdleInstances(),
        sweepIntervalMs,
      );
      this.sweepTimer.unref();
    }
  }

  // --- Instances ---

  public createInstance(
    zoneId: ZoneId,
    options: CreateInstanceOptions = {},
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
      runner: new InProcessWorldRunner(
        world,
        30,
        (result) => this.handleTick(instance, result),
        (error) => this.handleInstanceCrash(instance, error),
      ),
      players: new Set(),
      ownerPartyId: options.ownerPartyId,
      boundPortalKey: options.boundPortalKey,
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

  /** Live instances of a zone (closed and crashed instances are removed). */
  public getInstancesForZone(zoneId: ZoneId): Instance[] {
    return [...this.instances.values()].filter((i) => i.zone.id === zoneId);
  }

  /**
   * Stops an instance, destroys its world (releasing its entity IDs) and
   * forgets it. Players must have left already.
   */
  public closeInstance(
    instance: Instance,
    finalState: "closed" | "crashed" = "closed",
  ): void {
    if (instance.state === "closed" || instance.state === "crashed") return;
    instance.runner.stop();
    instance.world.destroy();
    instance.state = finalState;
    this.instances.delete(instance.id);
  }

  /**
   * Closes instances that have been empty longer than their zone's timeout,
   * keeping each zone's minimum number of warm instances.
   */
  public sweepIdleInstances(): Instance[] {
    const now = this.now();
    const closed: Instance[] = [];
    for (const zone of Object.values(ZONES)) {
      const instances = this.getInstancesForZone(zone.id);
      let alive = instances.length;
      const expired = instances
        .filter(
          (i) =>
            i.state === "empty" &&
            i.emptySince !== undefined &&
            now - i.emptySince >= zone.emptyTimeoutSec * 1000,
        )
        .sort((a, b) => a.emptySince! - b.emptySince!);
      for (const instance of expired) {
        if (alive <= (zone.minWarmInstances ?? 0)) break;
        this.closeInstance(instance);
        closed.push(instance);
        alive--;
      }
    }
    return closed;
  }

  /**
   * Fault isolation: a tick that throws takes down only its own instance.
   * Players inside are saved and moved to a nexus shard; every other
   * instance in the process keeps running.
   */
  private handleInstanceCrash(instance: Instance, error: unknown): void {
    console.error(
      `[InstanceHost] Instance ${instance.id} (zone ${instance.zone.id}) crashed:`,
      error,
    );
    const evacuated = [...instance.players];
    for (const playerId of evacuated) {
      const info = this.playerInfo.get(playerId);
      const state = instance.world.getPlayerPersistenceState(playerId);
      if (info && state) {
        persistenceService.queueSave(info.charId, state);
      }
      const nexus = this.placement.resolve({
        zoneId: "nexus",
        characterId: info?.charId ?? playerId,
      });
      if (!this.movePlayer(playerId, instance, nexus)) {
        instance.players.delete(playerId);
        this.playerInstance.delete(playerId);
      }
    }
    this.closeInstance(instance, "crashed");

    if (evacuated.length > 0) {
      this.messageBus.publishChat({
        sender: "System",
        text: `${instance.mapData.name} ran into a server error and was closed. You have been moved to the Nexus.`,
        kind: "system",
        targetPlayerIds: evacuated,
      });
    }
  }

  public getAllInstances(): Instance[] {
    return [...this.instances.values()];
  }

  public getPlayerName(playerId: string): string | undefined {
    return this.playerInfo.get(playerId)?.name;
  }

  /** Finds an online player by name (case-insensitive). */
  public findPlayerByName(name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const [playerId, info] of this.playerInfo) {
      if (info.name.toLowerCase() === wanted) return playerId;
    }
    return undefined;
  }

  public getInstanceForPlayer(playerId: string): Instance | undefined {
    const instanceId = this.playerInstance.get(playerId);
    return instanceId ? this.instances.get(instanceId) : undefined;
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
      this.transferPlayer(transfer.playerId, transfer.targetZoneId, {
        sourceInstanceId: instance.id,
        portalId: transfer.portalId,
      });
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

    // Players only log back into public zones; private and portal-bound
    // instances can't be rejoined from the login screen.
    const zoneId: ZoneId =
      options.zoneId &&
      isZoneId(options.zoneId) &&
      ZONES[options.zoneId].access.kind === "public_sharded"
        ? options.zoneId
        : "nexus";
    const instance = this.placement.resolve({
      zoneId,
      characterId: charId,
      partyId: this.getPartyId(charId),
    });
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
  public transferPlayer(
    playerId: string,
    targetZoneId: string,
    via?: { sourceInstanceId: InstanceId; portalId: string },
  ): boolean {
    if (!isZoneId(targetZoneId)) return false;
    const source = this.getInstanceForPlayer(playerId);
    const info = this.playerInfo.get(playerId);
    if (!source || !info) return false;

    let target: Instance;
    try {
      target = this.placement.resolve({
        zoneId: targetZoneId,
        characterId: info.charId,
        partyId: this.getPartyId(info.charId),
        via,
      });
    } catch (err) {
      console.error(`[InstanceHost] Cannot place ${playerId}:`, err);
      return false;
    }
    if (target.id === source.id) return false;
    return this.movePlayer(playerId, source, target);
  }

  /** Moves a player between two instances, preserving their session state. */
  private movePlayer(
    playerId: string,
    source: Instance,
    target: Instance,
  ): boolean {
    const info = this.playerInfo.get(playerId);
    const snapshot = snapshotCharacter(source.world, playerId);
    if (!snapshot) return false;

    // 1. Remove the player from the source instance
    this.removePlayerFromInstance(source, playerId);

    // 2. Spawn them in the target instance with their full state
    this.addPlayerToInstance(target, playerId);
    target.world.addPlayer(
      spawnOptionsFromSnapshot(snapshot, target.mapData.spawnPoint),
    );

    // 3. Tell the gateway
    this.messageBus.publishPlayerTransfer({
      playerId,
      targetInstanceId: target.id,
      zoneId: target.zone.id,
      mapData: target.mapData,
      spawnPoint: target.mapData.spawnPoint,
    });

    if (info) {
      this.broadcastChat(
        "System",
        `${info.name} entered ${target.mapData.name}`,
        "system",
      );
    }
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
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const instance of [...this.instances.values()]) {
      this.closeInstance(instance);
    }
    this.playerInstance.clear();
    this.playerInfo.clear();
  }
}
