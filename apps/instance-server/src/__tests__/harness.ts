/** Shared by the integration tests: a game client, ports, polling, characters. */
import net from "net";
import WebSocket from "ws";
import { prisma } from "@mmoexile/db";
import {
  deserializePacket,
  serializePacket,
  PROTOCOL_VERSION,
  type ServerPacket,
} from "@mmoexile/protocol";

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export class TestClient {
  readonly packets: ServerPacket[] = [];
  private ws: WebSocket;
  readonly closed: Promise<void>;

  constructor(url: string, ticket: string, protocolVersion = PROTOCOL_VERSION) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.on("message", (data: ArrayBuffer) =>
      this.packets.push(deserializePacket<ServerPacket>(data)),
    );
    this.ws.on("open", () =>
      this.ws.send(serializePacket({ type: "c2s_hello", ticket, protocolVersion })),
    );
    this.closed = new Promise((resolve) => this.ws.on("close", () => resolve()));
  }

  async next<T extends ServerPacket["type"]>(type: T, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.packets.find((p) => p.type === type);
      if (found) return found as Extract<ServerPacket, { type: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`No ${type} within ${timeoutMs} ms; got ${this.packets.map((p) => p.type)}`);
  }

  send(packet: Parameters<typeof serializePacket>[0]) {
    this.ws.send(serializePacket(packet));
  }

  close() {
    this.ws.close();
  }
}

export async function newCharacter(): Promise<{ characterId: string; accountId: string }> {
  const account = await prisma.account.create({
    data: { nickname: `Hero${Math.floor(Math.random() * 1e6)}`, refreshSecretHash: `h-${Math.random()}` },
  });
  const character = await prisma.character.create({ data: { accountId: account.id, hp: 100 } });
  return { characterId: character.id, accountId: account.id };
}

export const until = async (check: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};
