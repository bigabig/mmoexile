import type { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { serializePacket, type ServerPacket } from "@mmoexile/protocol";
import { ClientSession } from "./ClientSession.js";
import type { ITransportSocket } from "./transport/ITransportGateway.js";

export class SessionManager {
  private sessionsById = new Map<string, ClientSession>();
  private sessionsBySocket = new Map<
    WebSocket | ITransportSocket,
    ClientSession
  >();
  private sessionsByPlayerId = new Map<string, ClientSession>();

  public createSession(socket: WebSocket | ITransportSocket): ClientSession {
    const session = new ClientSession(randomUUID(), socket);
    this.sessionsById.set(session.id, session);
    this.sessionsBySocket.set(socket, session);
    return session;
  }

  public getSession(sessionId: string): ClientSession | undefined {
    return this.sessionsById.get(sessionId);
  }

  public getSessionBySocket(
    socket: WebSocket | ITransportSocket,
  ): ClientSession | undefined {
    return this.sessionsBySocket.get(socket);
  }

  public getSessionByPlayerId(playerId: string): ClientSession | undefined {
    return this.sessionsByPlayerId.get(playerId);
  }

  public bindPlayer(
    session: ClientSession,
    playerId: string,
    charId: string,
    nickname: string,
    instanceId: string,
  ): void {
    session.playerId = playerId;
    session.charId = charId;
    session.nickname = nickname;
    session.currentInstanceId = instanceId;
    this.sessionsByPlayerId.set(playerId, session);
  }

  public unbindPlayer(session: ClientSession): void {
    if (session.playerId) {
      this.sessionsByPlayerId.delete(session.playerId);
      session.playerId = undefined;
      session.charId = undefined;
      session.nickname = undefined;
      session.currentInstanceId = undefined;
    }
  }

  public removeSession(
    socketOrId: WebSocket | ITransportSocket | string,
  ): ClientSession | undefined {
    let session: ClientSession | undefined;
    if (typeof socketOrId === "string") {
      session = this.sessionsById.get(socketOrId);
    } else {
      session = this.sessionsBySocket.get(socketOrId);
    }

    if (session) {
      this.unbindPlayer(session);
      this.sessionsById.delete(session.id);
      if (typeof socketOrId !== "string") {
        this.sessionsBySocket.delete(socketOrId);
      }
      // Also clean up from sessionsBySocket if we found by id
      for (const [s, sess] of this.sessionsBySocket.entries()) {
        if (sess === session) {
          this.sessionsBySocket.delete(s);
          break;
        }
      }
    }
    return session;
  }

  public broadcastToPlayers(
    playerIds: Iterable<string>,
    data: ServerPacket | Uint8Array,
  ): void {
    const binary = data instanceof Uint8Array ? data : serializePacket(data);
    for (const pId of playerIds) {
      const session = this.sessionsByPlayerId.get(pId);
      if (session && session.isOpen) {
        session.sendBinary(binary);
      }
    }
  }

  public broadcastAll(data: ServerPacket | Uint8Array): void {
    const binary = data instanceof Uint8Array ? data : serializePacket(data);
    for (const session of this.sessionsById.values()) {
      if (session.isOpen) {
        session.sendBinary(binary);
      }
    }
  }

  public get size(): number {
    return this.sessionsById.size;
  }
}
