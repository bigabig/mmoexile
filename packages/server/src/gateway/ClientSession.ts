import type { WebSocket } from "ws";
import { serializePacket, type ServerPacket } from "@mmoexile/protocol";
import type {
  ITransportSession,
  ITransportSocket,
} from "./transport/ITransportGateway.js";

export class WebSocketTransportSocket implements ITransportSocket {
  constructor(private readonly ws: WebSocket) {}

  public get isOpen(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  public send(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  public close(): void {
    this.ws.close();
  }
}

export class ClientSession implements ITransportSession {
  public readonly id: string;
  private readonly socket: ITransportSocket;
  public playerId?: string;
  public charId?: string;
  public nickname?: string;
  public currentWorldId?: string;

  constructor(id: string, socket: ITransportSocket | WebSocket) {
    this.id = id;
    if ("readyState" in socket && typeof (socket as any).send === "function") {
      this.socket = new WebSocketTransportSocket(socket as WebSocket);
    } else {
      this.socket = socket as ITransportSocket;
    }
  }

  public get isOpen(): boolean {
    return this.socket.isOpen;
  }

  public send(packet: ServerPacket): void {
    if (this.isOpen) {
      this.socket.send(serializePacket(packet));
    }
  }

  public sendBinary(binary: Uint8Array): void {
    if (this.isOpen) {
      this.socket.send(binary);
    }
  }

  public close(): void {
    if (this.isOpen) {
      this.socket.close();
    }
  }
}
