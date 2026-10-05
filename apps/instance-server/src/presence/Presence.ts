import { redisKeys } from "@mmoexile/contracts";
import type { Redis } from "@mmoexile/messaging";

/** One online character. */
export interface PresenceEntry {
  characterId: string;
  name: string;
  /** The region the player chose at login (for the party leader rule). */
  homeRegion: string;
}

/**
 * Who is online, by which name and in which home region, across all
 * servers. Used for /invite <name> and to place a party's instances in the
 * leader's region. Entries expire unless refreshed by the hosting server.
 */
export interface Presence {
  set(entry: PresenceEntry): Promise<void>;
  remove(characterId: string, name: string): Promise<void>;
  findByName(name: string): Promise<string | undefined>;
  nameOf(characterId: string): Promise<string | undefined>;
  homeRegionOf(characterId: string): Promise<string | undefined>;
}

export class RedisPresence implements Presence {
  constructor(
    private readonly redis: Redis,
    private readonly serverId: string,
    private readonly ttlSeconds = 60,
  ) {}

  async set({ characterId, name, homeRegion }: PresenceEntry): Promise<void> {
    const value = JSON.stringify({ name, homeRegion, serverId: this.serverId });
    await this.redis
      .multi()
      .set(redisKeys.presence(characterId), value, "EX", this.ttlSeconds)
      .set(redisKeys.presenceByName(name), characterId, "EX", this.ttlSeconds)
      .exec();
  }

  async remove(characterId: string, name: string): Promise<void> {
    // Only remove entries that still point at this server's session.
    const raw = await this.redis.get(redisKeys.presence(characterId));
    if (raw && JSON.parse(raw).serverId !== this.serverId) return;
    await this.redis.del(redisKeys.presence(characterId));
    if ((await this.redis.get(redisKeys.presenceByName(name))) === characterId) {
      await this.redis.del(redisKeys.presenceByName(name));
    }
  }

  async findByName(name: string): Promise<string | undefined> {
    return (await this.redis.get(redisKeys.presenceByName(name))) ?? undefined;
  }

  async nameOf(characterId: string): Promise<string | undefined> {
    return (await this.get(characterId))?.name;
  }

  async homeRegionOf(characterId: string): Promise<string | undefined> {
    return (await this.get(characterId))?.homeRegion;
  }

  private async get(characterId: string): Promise<{ name?: string; homeRegion?: string } | undefined> {
    const raw = await this.redis.get(redisKeys.presence(characterId));
    return raw ? JSON.parse(raw) : undefined;
  }
}

export class InMemoryPresence implements Presence {
  private entries = new Map<string, PresenceEntry>();
  async set(entry: PresenceEntry) {
    this.entries.set(entry.characterId, entry);
  }
  async remove(characterId: string) {
    this.entries.delete(characterId);
  }
  async findByName(name: string) {
    const wanted = name.toLowerCase();
    for (const e of this.entries.values()) if (e.name.toLowerCase() === wanted) return e.characterId;
    return undefined;
  }
  async nameOf(characterId: string) {
    return this.entries.get(characterId)?.name;
  }
  async homeRegionOf(characterId: string) {
    return this.entries.get(characterId)?.homeRegion;
  }
}
