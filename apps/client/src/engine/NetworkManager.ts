import {
  MapData,
  ProjectileState,
  DamageEvent,
  isSolidTile,
  resolveCircleTileCollision,
} from "@mmoexile/game-core";
import {
  ClientPacket,
  ServerPacket,
  deserializePacket,
  serializePacket,
  EntityState,
} from "@mmoexile/protocol";

export interface NetworkCallbacks {
  onWelcome?: (playerId: string, instanceId: string, map: MapData) => void;
  onSnapshot?: (entities: EntityState[]) => void;
  onBulletSpawn?: (bullet: ProjectileState) => void;
  onDamage?: (event: DamageEvent) => void;
  onInstanceTransfer?: (
    instanceId: string,
    zoneId: string,
    map: MapData,
    spawnX: number,
    spawnY: number,
  ) => void;
  onChat?: (sender: string, text: string, kind: "system" | "player") => void;
  onDisconnected?: () => void;
}

interface PendingInput {
  seq: number;
  moveX: number;
  moveY: number;
  angle: number;
  dt: number;
}

export class NetworkManager {
  private socket: WebSocket | null = null;
  private callbacks: NetworkCallbacks;
  public localPlayerId: string | null = null;
  public token: string | null = null;
  public currentMap: MapData | null = null;

  // Client-side prediction
  public localPos = { x: 20, y: 20 };
  public localAngle = 0;
  public localSpeed: number = 5.0;
  private inputSequence = 0;
  private pendingInputs: PendingInput[] = [];

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(url: string, nickname: string, token?: string): void {
    if (this.socket) {
      this.socket.close();
    }

    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";

    this.socket.onopen = () => {
      console.log("[Network] Connected to game server");
      const joinPacket: ClientPacket = {
        type: "c2s_join",
        nickname,
        token: token || undefined,
      };
      this.send(joinPacket);
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const packet = deserializePacket<ServerPacket>(
          event.data as ArrayBuffer,
        );
        this.handleServerPacket(packet);
      } catch (err) {
        console.error("[Network] Failed to deserialize packet:", err);
      }
    };

    this.socket.onclose = () => {
      console.log("[Network] Disconnected from server");
      this.callbacks.onDisconnected?.();
    };

    this.socket.onerror = (err) => {
      console.error("[Network] WebSocket error:", err);
    };
  }

  public send(packet: ClientPacket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(serializePacket(packet));
    }
  }

  /**
   * Applies player movement locally (prediction) and sends input packet to server
   */
  public applyMovementInput(
    moveX: number,
    moveY: number,
    angle: number,
    dt: number,
  ): void {
    this.inputSequence++;
    this.localAngle = angle;

    const input: PendingInput = {
      seq: this.inputSequence,
      moveX,
      moveY,
      angle,
      dt,
    };
    this.pendingInputs.push(input);

    // Apply movement prediction immediately
    if (moveX !== 0 || moveY !== 0) {
      const speed = this.localSpeed;
      const nextX = this.localPos.x + moveX * speed * dt;
      const nextY = this.localPos.y + moveY * speed * dt;

      if (this.currentMap) {
        const resolved = resolveCircleTileCollision(
          { x: nextX, y: nextY },
          0.35,
          (tx, ty) => isSolidTile(this.currentMap!, tx, ty),
        );
        this.localPos.x = resolved.x;
        this.localPos.y = resolved.y;
      } else {
        this.localPos.x = nextX;
        this.localPos.y = nextY;
      }
    }

    // Send packet to server
    this.send({
      type: "c2s_input",
      seq: input.seq,
      moveX,
      moveY,
      angle,
      dt,
    });
  }

  public sendShoot(angle: number): void {
    this.send({
      type: "c2s_shoot",
      angle,
    });
  }

  public sendInteract(): void {
    this.send({
      type: "c2s_interact",
    });
  }

  public sendChat(text: string): void {
    this.send({
      type: "c2s_chat",
      text,
    });
  }

  public sendLootItem(bagId: string, itemIndex?: number): void {
    this.send({
      type: "c2s_loot_item",
      bagId,
      itemIndex,
    });
  }

  public sendLootAll(bagId: string): void {
    this.send({
      type: "c2s_loot_all",
      bagId,
    });
  }

  public sendEquipItem(inventoryIndex: number, slot: "weapon" | "armor"): void {
    this.send({
      type: "c2s_equip_item",
      inventoryIndex,
      slot,
    });
  }

  public sendUnequipItem(
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ): void {
    this.send({
      type: "c2s_unequip_item",
      slot,
      targetInventoryIndex,
    });
  }

  public sendSwapInventorySlots(fromIndex: number, toIndex: number): void {
    this.send({
      type: "c2s_swap_inventory_slots",
      fromIndex,
      toIndex,
    });
  }

  public sendDropItem(
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ): void {
    this.send({
      type: "c2s_drop_item",
      fromSlot,
      inventoryIndex,
    });
  }

  private handleServerPacket(packet: ServerPacket): void {
    switch (packet.type) {
      case "s2c_welcome": {
        this.localPlayerId = packet.playerId;
        this.token = packet.token;
        this.currentMap = packet.map;
        this.localPos.x = packet.playerState.x;
        this.localPos.y = packet.playerState.y;
        this.localSpeed = packet.playerState.classId === "knight" ? 4.8 : 5.5;
        this.pendingInputs = [];
        this.callbacks.onWelcome?.(
          packet.playerId,
          packet.instanceId,
          packet.map,
        );
        break;
      }

      case "s2c_snapshot": {
        // Discard acknowledged inputs
        this.pendingInputs = this.pendingInputs.filter(
          (i) => i.seq > packet.lastAckSeq,
        );

        // Find local player in snapshot for reconciliation
        const localServerEntity = packet.entities.find(
          (e) => e.id === this.localPlayerId,
        );
        if (localServerEntity && this.currentMap) {
          const dx = this.localPos.x - localServerEntity.x;
          const dy = this.localPos.y - localServerEntity.y;
          const distSq = dx * dx + dy * dy;

          // If divergence is significant (> 0.4 tiles), reconcile
          if (distSq > 0.16) {
            let reconX = localServerEntity.x;
            let reconY = localServerEntity.y;

            // Re-apply remaining pending inputs
            for (const input of this.pendingInputs) {
              const speed = this.localSpeed;
              const nx = reconX + input.moveX * speed * input.dt;
              const ny = reconY + input.moveY * speed * input.dt;
              const res = resolveCircleTileCollision(
                { x: nx, y: ny },
                0.35,
                (tx, ty) => isSolidTile(this.currentMap!, tx, ty),
              );
              reconX = res.x;
              reconY = res.y;
            }

            this.localPos.x = reconX;
            this.localPos.y = reconY;
          }
        }

        this.callbacks.onSnapshot?.(packet.entities);
        break;
      }

      case "s2c_bullet_spawn": {
        this.callbacks.onBulletSpawn?.(packet.bullet);
        break;
      }

      case "s2c_damage": {
        this.callbacks.onDamage?.(packet.event);
        break;
      }

      case "s2c_instance_transfer": {
        this.currentMap = packet.map;
        this.localPos.x = packet.spawnX;
        this.localPos.y = packet.spawnY;
        this.pendingInputs = [];
        this.callbacks.onInstanceTransfer?.(
          packet.instanceId,
          packet.zoneId,
          packet.map,
          packet.spawnX,
          packet.spawnY,
        );
        break;
      }

      case "s2c_chat": {
        this.callbacks.onChat?.(packet.sender, packet.text, packet.kind);
        break;
      }
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
