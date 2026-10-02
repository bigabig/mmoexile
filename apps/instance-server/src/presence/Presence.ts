import { redisKeys } from "@mmoexile/contracts";
import type { Redis } from "@mmoexile/messaging";

/**
 * Who is online, and by which name, across all servers. Used for
 * /invite <name>. Entries expire unless refreshed by the hosting server.
 */
export interface Presence {
  set(characterId: string, name: string): Promise<void>;
  remove(characterId: string, name: string): Promise<void>;
  findByName(name: string): Promise<string | undefined>;
  nameOf(characterId: string): Promise<string | undefined>;
}

export class RedisPresence implements Presence {
  constructor(
    private readonly redis: Redis,
    private readonly serverId: string,
    private readonly ttlSeconds = 60,
  ) {}

  async set(characterId: string, name: string): Promise<void> {
    const value = JSON.stringify({ name, serverId: this.serverId });
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
    const raw = await this.redis.get(redisKeys.presence(characterId));
    return raw ? JSON.parse(raw).name : undefined;
  }
}

export class InMemoryPresence implements Presence {
  private names = new Map<string, string>();
  async set(characterId: string, name: string) {
    this.names.set(characterId, name);
  }
  async remove(characterId: string) {
    this.names.delete(characterId);
  }
  async findByName(name: string) {
    const wanted = name.toLowerCase();
    for (const [id, n] of this.names) if (n.toLowerCase() === wanted) return id;
    return undefined;
  }
  async nameOf(characterId: string) {
    return this.names.get(characterId);
  }
}
