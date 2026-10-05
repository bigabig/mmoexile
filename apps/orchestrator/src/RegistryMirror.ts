import type { Redis } from "@mmoexile/messaging";
import { redisKeys, ServerView } from "@mmoexile/contracts";

/**
 * Copies the registry to Redis, so a restarted orchestrator starts with a
 * warm view instead of an empty fleet. Heartbeats stay the source of truth:
 * entries expire on their own once servers stop reporting.
 */
export class RegistryMirror {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 60_000,
  ) {}

  async save(view: ServerView): Promise<void> {
    await this.redis.set(
      redisKeys.fleetServer(view.serverId),
      JSON.stringify(view),
      "PX",
      this.ttlMs,
    );
  }

  async remove(serverId: string): Promise<void> {
    await this.redis.del(redisKeys.fleetServer(serverId));
  }

  async load(): Promise<ServerView[]> {
    const views: ServerView[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        redisKeys.fleetServerPattern,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length === 0) continue;
      for (const raw of await this.redis.mget(...keys)) {
        const parsed = raw ? ServerView.safeParse(JSON.parse(raw)) : undefined;
        if (parsed?.success) views.push(parsed.data);
      }
    } while (cursor !== "0");
    return views;
  }
}
