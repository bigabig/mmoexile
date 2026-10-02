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
  SnapshotEncoder,
  type KickReason,
} from "@mmoexile/protocol";
import { SessionManager } from "./SessionManager.js";
import {
  InstanceHost,
  type IMessageBus,
  InMemoryMessageBus,
} from "../cluster/index.js";
import type {
  AdmittedPlayer,
  PlayerLifecycle,
} from "../players/PlayerLifecycle.js";
import type { ClientSession } from "./ClientSession.js";
import type { ITransportGateway } from "./transport/ITransportGateway.js";
import { channels } from "@mmoexile/contracts";
import type { Broker } from "@mmoexile/messaging";
import type { PartyDirectory } from "../party/PartyDirectory.js";
import type { PartyCache, PartyUpdate } from "../party/PartyCache.js";
import type { Presence } from "../presence/Presence.js";
import { ChatCommands } from "../chat/ChatCommands.js";

/** Cross-server social features the gateway relies on. */
export interface GatewaySocial {
  parties: PartyDirectory;
  partyCache: PartyCache;
  presence: Presence;
  broker: Broker;
}

export class WebSocketGateway implements ITransportGateway {
  private readonly wss: WebSocketServer;
  public readonly sessionManager: SessionManager;
  public readonly host: InstanceHost;
  public readonly messageBus: IMessageBus;
  private readonly commands: ChatCommands;
  private readonly lifecycle: PlayerLifecycle;
  private readonly social: GatewaySocial;

  constructor(
    httpServer: HttpServer,
    host: InstanceHost,
    lifecycle: PlayerLifecycle,
    social: GatewaySocial,
    sessionManager: SessionManager = new SessionManager(),
    messageBus?: IMessageBus,
  ) {
    this.host = host;
    this.lifecycle = lifecycle;
    this.social = social;
    this.commands = new ChatCommands({
      host,
      parties: social.parties,
      presence: social.presence,
      broker: social.broker,
      onError: (err) => console.error("[ChatCommands]", err),
    });
    this.sessionManager = sessionManager;
    this.messageBus = messageBus ?? host.messageBus ?? new InMemoryMessageBus();
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.setupHostHooks();
    social.partyCache.onUpdate((update) => void this.sendPartyUpdate(update));
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

      // C. Send snapshot with per-player AOI entities and lastAckSeq. Each
      //    entity is encoded once per tick, however many players see it.
      if (result.snapshot) {
        const { tick, serverTime, lastAckSeqs, entities, playerSnapshots } =
          result.snapshot;
        const encoder = new SnapshotEncoder();
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
            session.sendBinary(encoder.encode(packet));
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
        // Global messages (logins, deaths) reach every server via the broker.
        void this.social.broker.publish(channels.chatGlobal, {
          senderName: sender,
          text,
          kind,
        });
      }
      },
    );
  }

  /** Delivers cross-server chat to the players connected here. */
  public async subscribeToSharedChat(): Promise<void> {
    const toPacket = (
      sender: string,
      text: string,
      kind: "system" | "player",
      channel: "global" | "party",
    ) =>
      serializePacket({
        type: "s2c_chat",
        sender,
        text,
        kind,
        channel,
        timestamp: Date.now(),
      });
    await this.social.broker.subscribe(channels.chatGlobal, (m) =>
      this.sessionManager.broadcastAll(
        toPacket(m.senderName, m.text, m.kind, "global"),
      ),
    );
    await this.social.broker.subscribe(channels.chatParty, (m) =>
      this.sessionManager.broadcastToPlayers(
        m.memberIds,
        toPacket(m.senderName, m.text, m.kind, "party"),
      ),
    );
  }

  private async sendPartyUpdate({ party, removed }: PartyUpdate): Promise<void> {
    if (party) {
      const members = await Promise.all(
        party.members.map(async (id) => ({
          id,
          name:
            this.host.getPlayerName(id) ??
            (await this.social.presence.nameOf(id)) ??
            "Offline",
          isLeader: id === party.leaderId,
        })),
      );
      const packet: S2C_PartyUpdatePacket = {
        type: "s2c_party_update",
        partyId: party.id,
        members,
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

  /** A disconnect (not a handoff or kick) leaves the party. */
  private async leavePartyOnDisconnect(
    characterId: string,
    name: string,
  ): Promise<void> {
    try {
      const before = await this.social.parties.getParty(characterId);
      if (!before) return;
      const result = await this.social.parties.leave(characterId);
      const others = before.members.filter((id) => id !== characterId);
      if (!result.ok || others.length === 0) return;
      await this.social.broker.publish(channels.chatParty, {
        senderName: "Party",
        text: result.party
          ? `${name} disconnected and left the party.`
          : `${name} disconnected. Your party was disbanded.`,
        kind: "system",
        memberIds: others,
      });
    } catch (err) {
      console.error("[WebSocketGateway] Leaving party failed:", err);
    }
  }

  private welcomePacket(player: AdmittedPlayer): S2C_WelcomePacket {
    const { record, character, map } = player;
    return {
      type: "s2c_welcome",
      playerId: player.characterId,
      instanceId: player.instanceId,
      zoneId: player.zoneId,
      map,
      playerState: {
        id: player.characterId,
        type: "player",
        subtype: record.class,
        x: map.spawnPoint.x,
        y: map.spawnPoint.y,
        vx: 0,
        vy: 0,
        angle: 0,
        hp: record.hp,
        maxHp: record.maxHp,
        mp: record.mp,
        maxMp: record.maxMp,
        name: player.name,
        level: record.level,
        defense: record.defense,
        classId: record.class,
        equipment: {
          weapon: record.equippedWeapon,
          armor: record.equippedArmor,
        },
        inventory: character.inventory,
        xp: record.xp,
        nextLevelXp: Math.floor(100 * Math.pow(record.level, 1.35)),
        isAlive: true,
        modelId: record.class === "knight" ? "knight" : "player",
      },
    };
  }

  /** Tells a client to reconnect elsewhere (zone change); see PlayerLifecycle. */
  public sendReconnect(
    characterId: string,
    url: string,
    ticket: string,
    zoneId: string,
  ): void {
    const session = this.sessionManager.getSessionByPlayerId(characterId);
    if (!session) return;
    session.send({ type: "s2c_reconnect", url, ticket, zoneId });
    // The character already left this server; closing must not save again.
    this.sessionManager.unbindPlayer(session);
    setTimeout(() => session.close(1000, "Reconnect"), 5000).unref();
  }

  /** Ends a client session with a reason. */
  public kickSession(characterId: string, reason: KickReason): void {
    const session = this.sessionManager.getSessionByPlayerId(characterId);
    if (session) this.endSession(session, reason);
  }

  private endSession(session: ClientSession, reason: KickReason): void {
    session.send({ type: "s2c_kicked", reason });
    this.sessionManager.unbindPlayer(session);
    session.close(4000, reason);
  }

  private setupWebSocketListeners(): void {
    this.wss.on("connection", (socket: WebSocket) => {
      const session = this.sessionManager.createSession(socket);

      socket.on("message", async (data: Buffer | ArrayBuffer) => {
        try {
          const packet = deserializePacket<ClientPacket>(data as ArrayBuffer);

          switch (packet.type) {
            case "c2s_hello": {
              if (session.playerId || session.admitting) return;
              session.admitting = true;
              const result = await this.lifecycle.admit(
                packet.ticket,
                packet.protocolVersion,
              );
              session.admitting = false;
              if (!result.ok) {
                this.endSession(session, result.reason);
                return;
              }
              const player = result.player;
              if (!session.isOpen) {
                // The client vanished while being admitted.
                await this.lifecycle.leave(player.characterId);
                return;
              }
              this.sessionManager.bindPlayer(
                session,
                player.characterId,
                player.characterId,
                player.name,
                player.instanceId,
              );
              session.send(this.welcomePacket(player));
              this.host.broadcastChat(
                "System",
                player.arrivedViaPortal
                  ? `${player.name} entered ${player.map.name}`
                  : `${player.name} logged in.`,
                "system",
                player.arrivedViaPortal ? player.instanceId : undefined,
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
          void this.leavePartyOnDisconnect(
            session.playerId,
            session.nickname ?? "A member",
          );
          void this.lifecycle.leave(session.playerId);
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
