import type { ServerPacket } from "@mmoexile/protocol";
import type { SessionManager } from "../SessionManager.js";

/**
 * Low-level transport socket interface (WebSockets, WebRTC DataChannels, WebTransport streams)
 */
export interface ITransportSocket {
  readonly isOpen: boolean;
  send(data: Uint8Array | string): void;
  close(): void;
}

/**
 * Logical client session representing a connected player independently of physical transport.
 */
export interface ITransportSession {
  readonly id: string;
  readonly isOpen: boolean;
  playerId?: string;
  charId?: string;
  nickname?: string;
  currentWorldId?: string;
  send(packet: ServerPacket): void;
  sendBinary(binary: Uint8Array): void;
  close(): void;
}

/**
 * Gateway interface abstracting network transport lifecycle and session management.
 */
export interface ITransportGateway {
  readonly sessionManager: SessionManager;
  start?(): Promise<void> | void;
  close(): Promise<void> | void;
}

