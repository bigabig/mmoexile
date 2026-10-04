import WebSocket from "ws";
import {
  accountApi,
  createHttpClient,
  type CharacterSummary,
} from "@mmoexile/contracts";
import { isSolidTile, type MapData } from "@mmoexile/game-core";
import {
  deserializePacket,
  serializePacket,
  PROTOCOL_VERSION,
  type ClientPacket,
  type KickReason,
  type ServerPacket,
} from "@mmoexile/protocol";

export interface BotOptions {
  /** account-api base URL, e.g. http://localhost:8080/api */
  apiUrl: string;
  name: string;
  /** Region to play in (default "local", as in `pnpm dev`). */
  region?: string;
  classId?: "wizard" | "knight";
  log?: (message: string) => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * A headless player that speaks the real protocol: logs in through
 * account-api, plays a character, follows reconnects, and walks to portals
 * with breadth-first pathfinding over the zone's tile map.
 */
export class Bot {
  readonly name: string;
  characterId = "";
  /**
   * Characters this bot saw die. The death is saved asynchronously, so
   * account-api may still list one as alive for a moment.
   */
  private readonly fallen = new Set<string>();
  zoneId = "";
  instanceId = "";
  serverUrl = "";
  position: Point | null = null;
  hp = 0;
  kicked: KickReason | null = null;
  /** The connection dropped without a kick or reconnect (server died). */
  disconnected = false;
  readonly packets: ServerPacket[] = [];
  readonly stats = { welcomes: 0, reconnects: 0, kicks: 0, errors: 0, disconnects: 0 };
  /** Welcomes per server URL: where this bot was placed. */
  readonly servers = new Map<string, number>();

  private readonly call;
  private sessionToken: string | undefined;
  private socket: WebSocket | null = null;
  private map: MapData | null = null;
  private seq = 0;
  private readonly log: (message: string) => void;

  constructor(private readonly options: BotOptions) {
    this.name = options.name;
    this.log = options.log ?? (() => {});
    this.call = createHttpClient({
      baseUrl: options.apiUrl,
      token: () => this.sessionToken,
    });
  }

  /** Guest login and a living character (created if needed). */
  async signIn(): Promise<void> {
    const login = await this.call(accountApi.guestLogin, { nickname: this.name });
    this.sessionToken = login.sessionToken;
    await this.ensureCharacter();
  }

  async ensureCharacter(): Promise<CharacterSummary> {
    const { characters } = await this.call(accountApi.listCharacters, undefined);
    const alive = characters.find((c) => c.isAlive && !this.fallen.has(c.id));
    const character =
      alive ??
      (await this.call(accountApi.createCharacter, {
        classId: this.options.classId ?? "wizard",
      })).character;
    this.characterId = character.id;
    return character;
  }

  /** Gets a ticket from account-api and connects to the nexus server. */
  async play(): Promise<void> {
    const { url, ticket } = await this.call(accountApi.play, {
      characterId: this.characterId,
      region: this.options.region ?? "local",
    });
    this.kicked = null;
    this.disconnected = false;
    await this.connect(url, ticket);
  }

  /** Walks to the portal leading to `zoneId` and uses it. */
  async travelTo(zoneId: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const startZone = this.zoneId;
    let path: Point[] = [];
    let welcomes = this.stats.welcomes;
    while (this.zoneId !== zoneId) {
      // Moved (e.g. a drain sent us to another shard of the same zone): new spawn, new path
      if (this.stats.welcomes !== welcomes) {
        welcomes = this.stats.welcomes;
        path = [];
      }
      if (this.kicked) throw new Error(`${this.name} was kicked: ${this.kicked}`);
      if (this.disconnected) throw new Error(`${this.name} lost its connection`);
      if (this.hp <= 0) throw new Error(`${this.name} died`);
      if (Date.now() > deadline) {
        throw new Error(`${this.name} did not reach ${zoneId} from ${startZone}`);
      }
      if (this.map && this.position && this.socket) {
        if (path.length === 0) path = this.pathToPortal(zoneId);
        const next = path[0];
        if (next) {
          const dx = next.x - this.position.x;
          const dy = next.y - this.position.y;
          if (Math.hypot(dx, dy) < 0.3) {
            path.shift();
            if (path.length === 0) this.send({ type: "c2s_interact" });
          } else {
            this.send({
              type: "c2s_input",
              seq: ++this.seq,
              moveX: Math.abs(dx) > 0.1 ? Math.sign(dx) : 0,
              moveY: Math.abs(dy) > 0.1 ? Math.sign(dy) : 0,
              angle: 0,
              dt: 0.033,
            });
          }
        }
      } else {
        path = [];
      }
      await sleep(33);
    }
  }

  /** Connected and in a zone (not kicked, not between servers). */
  get online(): boolean {
    return (
      this.socket?.readyState === WebSocket.OPEN &&
      this.map !== null &&
      this.kicked === null &&
      !this.disconnected
    );
  }

  say(text: string): void {
    this.send({ type: "c2s_chat", text });
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
  }

  async waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`${this.name}: wait timed out`);
      await sleep(25);
    }
  }

  private connect(url: string, ticket: string): Promise<void> {
    this.disconnect();
    this.serverUrl = url;
    const welcomesBefore = this.stats.welcomes;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.on("open", () =>
      this.send({ type: "c2s_hello", ticket, protocolVersion: PROTOCOL_VERSION }),
    );
    socket.on("message", (data: ArrayBuffer) =>
      this.handle(deserializePacket<ServerPacket>(data)),
    );
    socket.on("error", () => this.stats.errors++);
    socket.on("close", () => {
      // Our own disconnect() removes listeners first; anything else is a drop.
      if (this.socket === socket && this.kicked === null) {
        this.disconnected = true;
        this.stats.disconnects++;
      }
    });
    return this.waitFor(
      () => this.stats.welcomes > welcomesBefore || this.kicked !== null || this.disconnected,
      15_000,
    );
  }

  private handle(packet: ServerPacket): void {
    this.packets.push(packet);
    if (this.packets.length > 500) this.packets.splice(0, 250);
    switch (packet.type) {
      case "s2c_welcome":
        this.stats.welcomes++;
        this.servers.set(this.serverUrl, (this.servers.get(this.serverUrl) ?? 0) + 1);
        this.zoneId = packet.zoneId;
        this.instanceId = packet.instanceId;
        this.map = packet.map;
        this.position = { x: packet.playerState.x, y: packet.playerState.y };
        this.hp = packet.playerState.hp;
        this.log(`${this.name} welcome ${packet.instanceId} on ${this.serverUrl}`);
        break;
      case "s2c_snapshot":
        for (const e of packet.entities) {
          if (e.id === this.characterId) {
            this.position = { x: e.x, y: e.y };
            this.hp = e.hp;
            if (e.hp <= 0) this.fallen.add(this.characterId);
          }
        }
        break;
      case "s2c_reconnect":
        this.stats.reconnects++;
        this.position = null;
        this.map = null;
        void this.connect(packet.url, packet.ticket).catch(() => this.stats.errors++);
        break;
      case "s2c_chat":
        // Deaths are only announced in chat (permadeath), not as a packet.
        if (packet.sender === "Graveyard" && packet.text.startsWith(`${this.name} was slain`)) {
          this.hp = 0;
          this.fallen.add(this.characterId);
        }
        break;
      case "s2c_kicked":
        this.stats.kicks++;
        this.kicked = packet.reason;
        this.log(`${this.name} kicked: ${packet.reason}`);
        break;
    }
  }

  private send(packet: ClientPacket): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(serializePacket(packet));
    }
  }

  private pathToPortal(zoneId: string): Point[] {
    const map = this.map!;
    const portal = map.entities.find(
      (e) => (e.overrides as any)?.Portal?.targetZoneId === zoneId,
    );
    if (!portal) throw new Error(`No portal to ${zoneId} in ${map.id}`);
    return findPath(map, this.position!, (portal.overrides as any).Position);
  }
}

/** Breadth-first search over walkable tiles, returning tile centers. */
export function findPath(map: MapData, from: Point, to: Point): Point[] {
  const key = (x: number, y: number) => y * map.width + x;
  const start = { x: Math.floor(from.x), y: Math.floor(from.y) };
  const goal = { x: Math.floor(to.x), y: Math.floor(to.y) };
  const previous = new Map<number, number>([[key(start.x, start.y), -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === goal.x && current.y === goal.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (
        nx < 0 || ny < 0 || nx >= map.width || ny >= map.height ||
        isSolidTile(map, nx, ny) || previous.has(key(nx, ny))
      ) {
        continue;
      }
      previous.set(key(nx, ny), key(current.x, current.y));
      queue.push({ x: nx, y: ny });
    }
  }
  const path: Point[] = [];
  let k = key(goal.x, goal.y);
  if (!previous.has(k)) return path;
  while (k !== -1) {
    path.unshift({ x: (k % map.width) + 0.5, y: Math.floor(k / map.width) + 0.5 });
    k = previous.get(k)!;
  }
  return path;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
