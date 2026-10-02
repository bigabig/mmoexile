import { encode, decode } from "@msgpack/msgpack";
import type { DamageEvent, MapData, ProjectileState } from "@mmoexile/game-core";
import type { EntityState } from "./snapshot.js";

/**
 * Bumped on incompatible protocol changes; the server rejects clients with a
 * different version (s2c_kicked "version_mismatch").
 */
export const PROTOCOL_VERSION = 2;

export type PacketType =
  | "c2s_hello"
  | "c2s_input"
  | "c2s_shoot"
  | "c2s_interact"
  | "c2s_chat"
  | "c2s_loot_item"
  | "c2s_loot_all"
  | "c2s_equip_item"
  | "c2s_unequip_item"
  | "c2s_swap_inventory_slots"
  | "c2s_drop_item"
  | "s2c_welcome"
  | "s2c_snapshot"
  | "s2c_bullet_spawn"
  | "s2c_damage"
  | "s2c_instance_transfer"
  | "s2c_chat"
  | "s2c_party_update"
  | "s2c_reconnect"
  | "s2c_kicked";

/**
 * First packet on every connection to an instance server. The ticket comes
 * from account-api (/play) or from s2c_reconnect.
 */
export interface C2S_HelloPacket {
  type: "c2s_hello";
  ticket: string;
  protocolVersion: number;
}

export interface C2S_InputPacket {
  type: "c2s_input";
  seq: number;
  moveX: number; // -1, 0, 1
  moveY: number; // -1, 0, 1
  angle: number; // facing/aiming angle in radians
  dt: number; // input delta time in seconds
}

export interface C2S_ShootPacket {
  type: "c2s_shoot";
  angle: number;
}

export interface C2S_InteractPacket {
  type: "c2s_interact";
  portalId?: string;
}

export interface C2S_ChatPacket {
  type: "c2s_chat";
  text: string;
}

export interface C2S_LootItemPacket {
  type: "c2s_loot_item";
  bagId: string;
  itemIndex?: number;
}

export interface C2S_LootAllPacket {
  type: "c2s_loot_all";
  bagId: string;
}

export interface C2S_EquipItemPacket {
  type: "c2s_equip_item";
  inventoryIndex: number;
  slot: "weapon" | "armor";
}

export interface C2S_UnequipItemPacket {
  type: "c2s_unequip_item";
  slot: "weapon" | "armor";
  targetInventoryIndex?: number;
}

export interface C2S_SwapInventorySlotsPacket {
  type: "c2s_swap_inventory_slots";
  fromIndex: number;
  toIndex: number;
}

export interface C2S_DropItemPacket {
  type: "c2s_drop_item";
  fromSlot: "inventory" | "weapon" | "armor";
  inventoryIndex?: number;
}

export type ClientPacket =
  | C2S_HelloPacket
  | C2S_InputPacket
  | C2S_ShootPacket
  | C2S_InteractPacket
  | C2S_ChatPacket
  | C2S_LootItemPacket
  | C2S_LootAllPacket
  | C2S_EquipItemPacket
  | C2S_UnequipItemPacket
  | C2S_SwapInventorySlotsPacket
  | C2S_DropItemPacket;

export interface S2C_WelcomePacket {
  type: "s2c_welcome";
  playerId: string;
  instanceId: string;
  zoneId: string;
  map: MapData;
  playerState: EntityState;
}

export interface S2C_SnapshotPacket {
  type: "s2c_snapshot";
  tick: number;
  serverTime: number;
  lastAckSeq: number;
  entities: EntityState[];
}

export interface S2C_BulletSpawnPacket {
  type: "s2c_bullet_spawn";
  bullet: ProjectileState;
}

export interface S2C_DamagePacket {
  type: "s2c_damage";
  event: DamageEvent;
}

/** The player was moved into another instance (portal, crash, …). */
export interface S2C_InstanceTransferPacket {
  type: "s2c_instance_transfer";
  instanceId: string;
  zoneId: string;
  map: MapData;
  spawnX: number;
  spawnY: number;
}

/** Who a chat message was sent to: the current instance, everyone, or the party. */
export type ChatChannel = "local" | "global" | "party";

export interface S2C_ChatPacket {
  type: "s2c_chat";
  sender: string;
  text: string;
  kind: "system" | "player";
  channel: ChatChannel;
  timestamp: number;
}

export interface PartyMemberInfo {
  id: string;
  name: string;
  isLeader: boolean;
}

/** Sent to every member when a party changes; partyId null = not in a party. */
export interface S2C_PartyUpdatePacket {
  type: "s2c_party_update";
  partyId: string | null;
  members: PartyMemberInfo[];
}

/**
 * "Go connect over there": the player changes zone and must reconnect to
 * `url` with `ticket` (sent as c2s_hello). Shown as a loading screen.
 */
export interface S2C_ReconnectPacket {
  type: "s2c_reconnect";
  url: string;
  ticket: string;
  zoneId: string;
}

export type KickReason =
  | "logged_in_elsewhere"
  | "server_shutdown"
  | "invalid_ticket"
  | "version_mismatch"
  | "character_unavailable";

/** The server ends the session; the socket closes right after. */
export interface S2C_KickedPacket {
  type: "s2c_kicked";
  reason: KickReason;
}

export type ServerPacket =
  | S2C_WelcomePacket
  | S2C_SnapshotPacket
  | S2C_BulletSpawnPacket
  | S2C_DamagePacket
  | S2C_InstanceTransferPacket
  | S2C_ChatPacket
  | S2C_PartyUpdatePacket
  | S2C_ReconnectPacket
  | S2C_KickedPacket;

export type GamePacket = ClientPacket | ServerPacket;

export function serializePacket(packet: GamePacket): Uint8Array {
  return encode(packet);
}

export function deserializePacket<T = GamePacket>(
  buffer: Uint8Array | ArrayBuffer,
): T {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return decode(bytes) as T;
}
