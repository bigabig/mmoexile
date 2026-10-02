import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  deserializePacket,
  serializePacket,
  ClientPacket,
  S2C_WelcomePacket,
  S2C_SnapshotPacket,
  S2C_BulletSpawnPacket,
  S2C_DamagePacket,
  S2C_InstanceTransferPacket,
  S2C_ChatPacket,
  S2C_PartyUpdatePacket,
} from "@mmoexile/protocol";
import { SessionManager } from "./SessionManager.js";
import {
  InstanceHost,
  type IMessageBus,
  InMemoryMessageBus,
} from "../cluster/index.js";
import { accountService } from "../persistence/index.js";
import type { ITransportGateway } from "./transport/ITransportGateway.js";
import type { PartyChange, PartyService } from "../party/PartyService.js";
import { ChatCommands } from "../chat/ChatCommands.js";

export class WebSocketGateway implements ITransportGateway {
  private readonly wss: WebSocketServer;
  public readonly sessionManager: SessionManager;
  public readonly host: InstanceHost;
  public readonly parties: PartyService;
  public readonly messageBus: IMessageBus;
  private readonly commands: ChatCommands;

  constructor(
    httpServer: HttpServer,
    host: InstanceHost,
    parties: PartyService,
    sessionManager: SessionManager = new SessionManager(),
    messageBus?: IMessageBus,
  ) {
    this.host = host;
    this.parties = parties;
    this.commands = new ChatCommands(host, parties);
    this.sessionManager = sessionManager;
    this.messageBus = messageBus ?? host.messageBus ?? new InMemoryMessageBus();
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.setupHostHooks();
    this.parties.onChange((change) => this.sendPartyUpdate(change));
    this.setupWebSocketListeners();
  }

  private setupHostHooks(): void {
    // 1. Tick output broadcast (Batched & Pre-serialized for high performance)
    this.messageBus.onTickResult((_instanceId, result, playerIds) => {
      if (playerIds.size === 0) return;

      // A. Pre-serialize spawned bullets once and broadcast to world players
      for (const bullet of result.bullets) {
        const packet: S2C_BulletSpawnPacket = {
          type: "s2c_bullet_spawn",
          bullet,
        };
        const binary = serializePacket(packet);
        this.sessionManager.broadcastToPlayers(playerIds, binary);
      }

      // B. Pre-serialize damage events once and broadcast to world players
      for (const event of result.damageEvents) {
        const packet: S2C_DamagePacket = {
          type: "s2c_damage",
          event,
        };
        const binary = serializePacket(packet);
        this.sessionManager.broadcastToPlayers(playerIds, binary);
      }

      // C. Send snapshot with per-player AOI entities and lastAckSeq
      if (result.snapshot) {
        const { tick, serverTime, lastAckSeqs, entities, playerSnapshots } =
          result.snapshot;
        for (const pId of playerIds) {
          const session = this.sessionManager.getSessionByPlayerId(pId);
          if (session && session.isOpen) {
            const playerEntities = playerSnapshots?.[pId] ?? entities;
            const packet: S2C_SnapshotPacket = {
              type: "s2c_snapshot",
              tick,
              serverTime,
              lastAckSeq: lastAckSeqs[pId] ?? 0,
              entities: playerEntities,
            };
            session.send(packet);
          }
        }
      }
    });

    // 2. Instance transfer broadcast
    this.messageBus.onPlayerTransfer(
      ({ playerId, targetInstanceId, zoneId, mapData, spawnPoint }) => {
        const session = this.sessionManager.getSessionByPlayerId(playerId);
        if (session && session.isOpen) {
          session.currentInstanceId = targetInstanceId;
          const packet: S2C_InstanceTransferPacket = {
            type: "s2c_instance_transfer",
            instanceId: targetInstanceId,
            zoneId,
            map: mapData,
            spawnX: spawnPoint.x,
            spawnY: spawnPoint.y,
          };
          session.send(packet);
        }
      },
    );

    // 3. Chat broadcast
    this.messageBus.onChat(
      ({ sender, text, kind, targetInstanceId, targetPlayerIds, channel }) => {
      const packet: S2C_ChatPacket = {
        type: "s2c_chat",
        sender,
        text,
        kind,
        channel:
          channel ??
          (targetInstanceId || targetPlayerIds ? "local" : "global"),
        timestamp: Date.now(),
      };
      const binary = serializePacket(packet);

      if (targetPlayerIds) {
        this.sessionManager.broadcastToPlayers(targetPlayerIds, binary);
      } else if (targetInstanceId) {
        const instance = this.host.getInstance(targetInstanceId);
        if (instance) {
          this.sessionManager.broadcastToPlayers(instance.players, binary);
        }
      } else {
        this.sessionManager.broadcastAll(binary);
      }
      },
    );
  }

  private sendPartyUpdate({ party, removed }: PartyChange): void {
    if (party) {
      const packet: S2C_PartyUpdatePacket = {
        type: "s2c_party_update",
        partyId: party.id,
        members: party.members.map((id) => ({
          id,
          name: this.host.getPlayerName(id) ?? "Unknown",
          isLeader: id === party.leaderId,
        })),
      };
      this.sessionManager.broadcastToPlayers(party.members, packet);
    }
    if (removed.length > 0) {
      const packet: S2C_PartyUpdatePacket = {
        type: "s2c_party_update",
        partyId: null,
        members: [],
      };
      this.sessionManager.broadcastToPlayers(removed, packet);
    }
  }

  private setupWebSocketListeners(): void {
    this.wss.on("connection", (socket: WebSocket) => {
      const session = this.sessionManager.createSession(socket);

      socket.on("message", async (data: Buffer | ArrayBuffer) => {
        try {
          const packet = deserializePacket<ClientPacket>(data as ArrayBuffer);

          switch (packet.type) {
            case "c2s_join": {
              const { account, character, domainCharacter } =
                await accountService.loginOrRegister(
                  packet.nickname,
                  packet.token,
                );

              // Logins always start in a nexus shard (like PoE sending you to
              // town); character.lastZoneId is kept for later features.
              const { instanceId, zoneId, map } = this.host.registerPlayer({
                playerId: character.id,
                name: account.nickname,
                charId: character.id,
                zoneId: "nexus",
                character: domainCharacter,
              });

              this.sessionManager.bindPlayer(
                session,
                character.id,
                character.id,
                account.nickname,
                instanceId,
              );

              const welcomePacket: S2C_WelcomePacket = {
                type: "s2c_welcome",
                playerId: character.id,
                token: account.token,
                instanceId,
                zoneId,
                map,
                playerState: {
                  id: character.id,
                  type: "player",
                  subtype: character.class,
                  x: map.spawnPoint.x,
                  y: map.spawnPoint.y,
                  vx: 0,
                  vy: 0,
                  angle: 0,
                  hp: character.hp,
                  maxHp: character.maxHp,
                  mp: character.mp,
                  maxMp: character.maxMp,
                  name: account.nickname,
                  level: character.level,
                  defense: character.defense,
                  classId: character.class,
                  equipment: {
                    weapon: character.equippedWeapon,
                    armor: character.equippedArmor,
                  },
                  inventory: domainCharacter.inventory,
                  xp: character.xp,
                  nextLevelXp: Math.floor(
                    100 * Math.pow(character.level, 1.35),
                  ),
                  isAlive: true,
                  modelId: character.class === "knight" ? "knight" : "player",
                },
              };

              session.send(welcomePacket);
              this.host.broadcastChat(
                "System",
                `${account.nickname} entered the realm.`,
                "system",
              );
              break;
            }

            case "c2s_input": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "move",
                seq: packet.seq,
                moveX: packet.moveX,
                moveY: packet.moveY,
                angle: packet.angle,
                dt: packet.dt,
              });
              break;
            }

            case "c2s_shoot": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "shoot",
                angle: packet.angle,
              });
              break;
            }

            case "c2s_interact": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "interact",
                portalId: packet.portalId,
              });
              break;
            }

            case "c2s_loot_item": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "loot_item",
                bagId: packet.bagId,
                itemIndex: packet.itemIndex,
              });
              break;
            }

            case "c2s_loot_all": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "loot_all",
                bagId: packet.bagId,
              });
              break;
            }

            case "c2s_equip_item": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "equip_item",
                inventoryIndex: packet.inventoryIndex,
                slot: packet.slot,
              });
              break;
            }

            case "c2s_unequip_item": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "unequip_item",
                slot: packet.slot,
                targetInventoryIndex: packet.targetInventoryIndex,
              });
              break;
            }

            case "c2s_swap_inventory_slots": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "swap_slots",
                fromIndex: packet.fromIndex,
                toIndex: packet.toIndex,
              });
              break;
            }

            case "c2s_drop_item": {
              if (!session.playerId) return;
              this.messageBus.publishCommand(session.playerId, {
                type: "drop_item",
                fromSlot: packet.fromSlot,
                inventoryIndex: packet.inventoryIndex,
              });
              break;
            }

            case "c2s_chat": {
              if (!session.nickname || !session.playerId) return;
              if (this.commands.handle(session.playerId, packet.text)) break;
              // Plain chat stays inside the sender's instance (like RotMG).
              this.host.broadcastChat(
                session.nickname,
                packet.text,
                "player",
                this.host.getInstanceForPlayer(session.playerId)?.id,
              );
              break;
            }
          }
        } catch (err) {
          console.error(
            "[WebSocketGateway] Error handling client packet:",
            err,
          );
        }
      });

      socket.on("close", () => {
        if (session.playerId) {
          const change = this.parties.leave(session.playerId);
          if (change) {
            const remaining = change.party
              ? change.party.members
              : change.removed.filter((id) => id !== session.playerId);
            this.messageBus.publishChat({
              sender: "Party",
              text: change.party
                ? `${session.nickname ?? "A member"} disconnected and left the party.`
                : `${session.nickname ?? "A member"} disconnected. Your party was disbanded.`,
              kind: "system",
              targetPlayerIds: remaining,
            });
          }
          this.host.unregisterPlayer(session.playerId);
        }
        this.sessionManager.removeSession(socket);
      });

      socket.on("error", (err) => {
        console.error("[WebSocketGateway] Socket error:", err);
      });
    });
  }

  public close(): void {
    // ws does not close existing connections here, only stops accepting new ones.
    this.wss.close();
  }

  public disconnectAll(
    code: number = 1001,
    reason: string = "Server shutting down",
  ): void {
    for (const client of this.wss.clients) {
      client.close(code, reason);
    }
  }
}
