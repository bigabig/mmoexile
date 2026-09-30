import {
  STATIC_MAPS,
  MapData,
  CharacterData,
  Health,
  Progression,
  Equipment,
  Inventory,
  Identity,
} from "@mmoexile/shared";
import {
  GameWorld,
  type WorldTickResult,
  type PlayerCommand,
  type SpawnPlayerOptions,
} from "../simulation/index.js";
import { InProcessWorldRunner } from "./runners/InProcessWorldRunner.js";
import type { IWorldRunner } from "./runners/IWorldRunner.js";
import {
  persistenceService,
  type CharacterUpdateState,
} from "../persistence/index.js";

export interface WorldInstance {
  worldId: string;
  world: GameWorld;
  runner: IWorldRunner;
  mapData: MapData;
  playerIds: Set<string>;
}

export type TickOutputListener = (
  worldId: string,
  result: WorldTickResult,
  playerIds: ReadonlySet<string>,
) => void;

export type PlayerTransferListener = (
  playerId: string,
  targetWorldId: string,
  mapData: MapData,
  spawnPoint: { x: number; y: number },
) => void;

export type ChatBroadcastListener = (
  sender: string,
  text: string,
  kind: "system" | "player",
  targetWorldId?: string,
) => void;

export type PlayerDeathListener = (
  playerId: string,
  charId: string,
  playerName: string,
  worldName: string,
) => void;

import type { IMessageBus } from "./messaging/IMessageBus.js";
import { InMemoryMessageBus } from "./messaging/InMemoryMessageBus.js";

export class WorldCluster {
  private worlds = new Map<string, WorldInstance>();
  private playerWorldMap = new Map<string, string>();
  private playerInfo = new Map<string, { name: string; charId: string }>();

  // Optional socket reference map maintained solely for backward compatibility with existing tests
  private legacyPlayerSockets = new Map<string, any>();

  // Event Listeners for decoupled Gateway layer
  private tickOutputListeners: TickOutputListener[] = [];
  private transferListeners: PlayerTransferListener[] = [];
  private chatListeners: ChatBroadcastListener[] = [];
  private deathListeners: PlayerDeathListener[] = [];
  public readonly messageBus: IMessageBus;

  constructor(messageBus: IMessageBus = new InMemoryMessageBus()) {
    this.messageBus = messageBus;
    this.initStaticWorlds();
    this.setupMessageBus();
  }

  private setupMessageBus(): void {
    this.messageBus.onCommand((playerId, command) => {
      this.forwardCommand(playerId, command);
    });
  }

  private initStaticWorlds(): void {
    this.createWorld("nexus", STATIC_MAPS.nexus());
    this.createWorld("realm_1", STATIC_MAPS.realm_1());
    this.createWorld("dungeon_golem", STATIC_MAPS.dungeon_golem());
  }

  public onTickOutput(listener: TickOutputListener): () => void {
    this.tickOutputListeners.push(listener);
    return () => {
      this.tickOutputListeners = this.tickOutputListeners.filter(
        (l) => l !== listener,
      );
    };
  }

  public onPlayerTransferred(listener: PlayerTransferListener): () => void {
    this.transferListeners.push(listener);
    return () => {
      this.transferListeners = this.transferListeners.filter(
        (l) => l !== listener,
      );
    };
  }

  public onChatBroadcast(listener: ChatBroadcastListener): () => void {
    this.chatListeners.push(listener);
    return () => {
      this.chatListeners = this.chatListeners.filter((l) => l !== listener);
    };
  }

  public onPlayerDied(listener: PlayerDeathListener): () => void {
    this.deathListeners.push(listener);
    return () => {
      this.deathListeners = this.deathListeners.filter((l) => l !== listener);
    };
  }

  public createWorld(worldId: string, mapData: MapData): WorldInstance {
    if (this.worlds.has(worldId)) {
      return this.worlds.get(worldId)!;
    }

    const world = new GameWorld(worldId, mapData);
    const playerIds = new Set<string>();

    const runner = new InProcessWorldRunner(world, 30, (result) => {
      this.handleWorldTick(worldId, result, playerIds);
    });

    const instance: WorldInstance = {
      worldId,
      world,
      runner,
      mapData,
      playerIds,
    };

    this.worlds.set(worldId, instance);

    // Start simulation runner
    runner.start();

    return instance;
  }

  private handleWorldTick(
    worldId: string,
    result: WorldTickResult,
    playerIds: Set<string>,
  ): void {
    // 1. Process world transfers requested this tick
    for (const transfer of result.transfers) {
      this.transferPlayer(transfer.playerId, transfer.targetWorldId);
    }

    // 2. Process player level ups
    for (const lvl of result.levelUps) {
      this.broadcastChat(
        "Level Up",
        `🎉 ${lvl.playerName} has reached Level ${lvl.newLevel}!`,
        "system",
      );
    }

    // 3. Process deaths
    for (const death of result.deaths) {
      if (death.isPlayer) {
        const info = this.playerInfo.get(death.entityId);
        if (info) {
          persistenceService.handleDeath(info.charId);
          const world = this.getWorld(worldId);
          const worldName = world ? world.mapData.name : worldId;
          this.broadcastChat(
            "Graveyard",
            `${info.name} was slain in ${worldName}!`,
            "system",
          );
          this.messageBus.publishPlayerDeath({
            playerId: death.entityId,
            charId: info.charId,
            playerName: info.name,
            worldName,
          });
          for (const listener of this.deathListeners) {
            listener(death.entityId, info.charId, info.name, worldName);
          }
        }
      }
    }

    // 4. Periodic player state persistence (every 150 ticks = 5 seconds)
    if (result.tick % 150 === 0) {
      const world = this.getWorld(worldId);
      if (world) {
        const states = world.getPlayerPersistenceStates();
        for (const item of states) {
          const info = this.playerInfo.get(item.playerId);
          if (info) {
            persistenceService.queueSave(info.charId, item.state);
          }
        }
      }
    }

    // 5. Notify tick output listeners (Gateway / SessionManager broadcasts to network)
    // 5. Publish to message bus
    this.messageBus.publishTickResult(worldId, result, playerIds);

    // 6. Notify tick output listeners (Gateway / SessionManager broadcasts to network)
    for (const listener of this.tickOutputListeners) {
      try {
        listener(worldId, result, playerIds);
      } catch (err) {
        console.error(
          `[WorldCluster] Error in tickOutputListener for ${worldId}:`,
          err,
        );
      }
    }
  }

  public getWorld(worldId: string): GameWorld | undefined {
    return this.worlds.get(worldId)?.world;
  }

  public getWorldInstance(worldId: string): WorldInstance | undefined {
    return this.worlds.get(worldId);
  }

  public getWorldForPlayer(playerId: string): GameWorld | undefined {
    const worldId = this.playerWorldMap.get(playerId);
    return worldId ? this.getWorld(worldId) : undefined;
  }

  public registerPlayer(
    socketOrPlayerId: any,
    playerIdOrName: string,
    nameOrCharId?: string,
    charIdOrInitialWorld?: string,
    initialWorldOrInput?: string | any,
    characterInput?:
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
        },
  ): { worldId: string; map: MapData; playerEid: number } {
    let socket: any = undefined;
    let playerId: string;
    let name: string;
    let charId: string;
    let initialWorld: string = "nexus";
    let charData: any = undefined;

    // Check if called with legacy signature (socket as first parameter)
    if (typeof socketOrPlayerId === "object" && socketOrPlayerId !== null) {
      socket = socketOrPlayerId;
      playerId = playerIdOrName;
      name = nameOrCharId || "Player";
      charId = charIdOrInitialWorld || playerId;
      initialWorld =
        typeof initialWorldOrInput === "string" ? initialWorldOrInput : "nexus";
      charData = characterInput || initialWorldOrInput;
    } else {
      playerId = socketOrPlayerId;
      name = playerIdOrName;
      charId = nameOrCharId || playerId;
      initialWorld =
        typeof charIdOrInitialWorld === "string"
          ? charIdOrInitialWorld
          : "nexus";
      charData = initialWorldOrInput;
    }

    if (socket) {
      this.legacyPlayerSockets.set(playerId, socket);
    }
    this.playerInfo.set(playerId, { name, charId });

    const targetWorld = this.worlds.has(initialWorld) ? initialWorld : "nexus";
    const instance = this.worlds.get(targetWorld)!;

    this.playerWorldMap.set(playerId, targetWorld);
    instance.playerIds.add(playerId);

    let parsedInv: (string | null)[] | undefined = undefined;
    if (charData?.inventory) {
      if (Array.isArray(charData.inventory)) {
        parsedInv = charData.inventory;
      } else if (typeof charData.inventory === "string") {
        try {
          parsedInv = JSON.parse(charData.inventory);
        } catch {}
      }
    }

    const classId =
      charData && "classId" in charData && charData.classId
        ? charData.classId
        : (charData as any)?.class || "wizard";

    const level = charData?.level || 1;
    const xp = charData?.xp || 0;
    const hp = charData?.hp;
    const mp = charData?.mp;

    const weapon =
      charData && "equipment" in charData && charData.equipment
        ? charData.equipment.weapon
        : (charData as any)?.equippedWeapon;

    const armor =
      charData && "equipment" in charData && charData.equipment
        ? charData.equipment.armor
        : (charData as any)?.equippedArmor;

    const playerEid = instance.world.addPlayer({
      id: playerId,
      name,
      classId,
      level,
      xp,
      hp,
      mp,
      x: instance.mapData.spawnPoint.x,
      y: instance.mapData.spawnPoint.y,
      equipment: {
        weapon,
        armor,
      },
      inventory: parsedInv,
    });

    return {
      worldId: targetWorld,
      map: instance.mapData,
      playerEid,
    };
  }

  public unregisterPlayer(playerId: string): CharacterUpdateState | undefined {
    const worldId = this.playerWorldMap.get(playerId);
    const info = this.playerInfo.get(playerId);
    let finalState: CharacterUpdateState | undefined = undefined;

    if (worldId && info) {
      const instance = this.worlds.get(worldId);
      if (instance) {
        instance.playerIds.delete(playerId);
        const state = instance.world.getPlayerPersistenceState(playerId);

        if (state) {
          finalState = state;
          persistenceService.saveImmediate(info.charId, state);
        }

        instance.world.removePlayer(playerId);
      }
    }

    this.playerWorldMap.delete(playerId);
    this.legacyPlayerSockets.delete(playerId);
    this.playerInfo.delete(playerId);

    return finalState;
  }

  public forwardCommand(playerId: string, command: PlayerCommand): void {
    const worldId = this.playerWorldMap.get(playerId);
    if (!worldId) return;
    const instance = this.worlds.get(worldId);
    if (instance) {
      instance.world.enqueueCommand(playerId, command);
    }
  }

  // --- Convenience Forwarders (delegating to forwardCommand) ---

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
    this.forwardCommand(playerId, {
      type: "shoot",
      angle,
    });
  }

  public forwardInteract(playerId: string): void {
    this.forwardCommand(playerId, {
      type: "interact",
    });
  }

  public forwardLootItem(
    playerId: string,
    bagId: string,
    itemIndex?: number,
  ): void {
    this.forwardCommand(playerId, {
      type: "loot_item",
      bagId,
      itemIndex,
    });
  }

  public forwardLootAll(playerId: string, bagId: string): void {
    this.forwardCommand(playerId, {
      type: "loot_all",
      bagId,
    });
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
    this.forwardCommand(playerId, {
      type: "swap_slots",
      fromIndex,
      toIndex,
    });
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

  public broadcastChat(
    sender: string,
    text: string,
    kind: "system" | "player" = "player",
    targetWorldId?: string,
  ): void {
    this.messageBus.publishChat({ sender, text, kind, targetWorldId });
    for (const listener of this.chatListeners) {
      try {
        listener(sender, text, kind, targetWorldId);
      } catch (err) {
        console.error("[WorldCluster] Error in chatListener:", err);
      }
    }
  }

  public transferPlayer(playerId: string, targetWorldId: string): boolean {
    const currentWorldId = this.playerWorldMap.get(playerId);
    if (!currentWorldId || !this.worlds.has(targetWorldId)) return false;
    if (currentWorldId === targetWorldId) return false;

    const currentInstance = this.worlds.get(currentWorldId)!;
    const targetInstance = this.worlds.get(targetWorldId)!;
    const info = this.playerInfo.get(playerId);
    if (!info) return false;

    // 1. Remove player from current world while preserving their full session stats
    const currentEid = currentInstance.world.uuidToEid.get(playerId);
    if (currentEid === undefined) return false;

    const playerData: SpawnPlayerOptions = {
      id: playerId,
      name: Identity.name[currentEid],
      classId: Progression.classId[currentEid],
      level: Progression.level[currentEid],
      xp: Progression.xp[currentEid],
      hp: Health.current[currentEid],
      mp: 100,
      x: targetInstance.mapData.spawnPoint.x,
      y: targetInstance.mapData.spawnPoint.y,
      equipment: {
        weapon: Equipment.weapon[currentEid],
        armor: Equipment.armor[currentEid],
      },
      inventory: [...(Inventory.slots[currentEid] || new Array(8).fill(null))],
    };

    currentInstance.playerIds.delete(playerId);
    currentInstance.world.removePlayer(playerId);

    // 2. Add to target world at its spawn point
    this.playerWorldMap.set(playerId, targetWorldId);
    targetInstance.playerIds.add(playerId);
    targetInstance.world.addPlayer(playerData);

    // 3. Notify transfer listeners
    // 3. Publish transfer to message bus & notify transfer listeners
    this.messageBus.publishPlayerTransfer({
      playerId,
      targetWorldId,
      mapData: targetInstance.mapData,
      spawnPoint: targetInstance.mapData.spawnPoint,
    });
    for (const listener of this.transferListeners) {
      try {
        listener(
          playerId,
          targetWorldId,
          targetInstance.mapData,
          targetInstance.mapData.spawnPoint,
        );
      } catch (err) {
        console.error("[WorldCluster] Error in transferListener:", err);
      }
    }

    this.broadcastChat(
      "System",
      `${info.name} entered ${targetInstance.mapData.name}`,
      "system",
    );

    return true;
  }

  public prepareShutdown(): void {
    // 1. Stop all world runners immediately to freeze simulation state
    for (const instance of this.worlds.values()) {
      instance.runner.stop();
    }

    // 2. Extract final snapshots of all active players across all worlds
    for (const [worldId, instance] of this.worlds) {
      const states = instance.world.getPlayerPersistenceStates();
      for (const item of states) {
        const info = this.playerInfo.get(item.playerId);
        if (info) {
          persistenceService.queueSave(info.charId, item.state);
        }
      }
    }
  }

  public stop(): void {
    for (const instance of this.worlds.values()) {
      instance.runner.stop();
      instance.world.destroy();
    }
    this.worlds.clear();
    this.playerWorldMap.clear();
    this.legacyPlayerSockets.clear();
    this.playerInfo.clear();
    this.tickOutputListeners = [];
    this.transferListeners = [];
    this.chatListeners = [];
    this.deathListeners = [];
  }
}

// Backward-compatible alias
export { WorldCluster as WorldManager };
