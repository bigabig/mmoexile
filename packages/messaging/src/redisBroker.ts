import { Redis } from "ioredis";
import type { Channel, ChannelMessage } from "@mmoexile/contracts";
import { parseMessage, type Broker, type Unsubscribe } from "./broker.js";

export interface RedisBrokerOptions {
  /** Connection used for publishing (and any other commands). */
  redis: Redis;
  onInvalidMessage?: (channel: string, error: unknown) => void;
}

/**
 * Broker over Redis pub/sub. A Redis connection in subscriber mode can't run
 * other commands, so subscriptions use a dedicated duplicate connection.
 */
export class RedisBroker implements Broker {
  private readonly publisher: Redis;
  private subscriber: Redis | undefined;
  private handlers = new Map<string, Set<(raw: unknown) => void>>();
  private readonly onInvalid: (channel: string, error: unknown) => void;

  constructor(options: RedisBrokerOptions) {
    this.publisher = options.redis;
    this.onInvalid =
      options.onInvalidMessage ??
      ((channel, error) =>
        console.error(`[RedisBroker] Invalid ${channel} message`, error));
  }

  async publish<C extends Channel>(
    channel: C,
    message: ChannelMessage<C>,
  ): Promise<void> {
    await this.publisher.publish(channel.name, JSON.stringify(message));
  }

  async subscribe<C extends Channel>(
    channel: C,
    handler: (message: ChannelMessage<C>) => void,
  ): Promise<Unsubscribe> {
    const subscriber = this.ensureSubscriber();
    const wrapped = (raw: unknown) => {
      const message = parseMessage(channel, raw, (err) =>
        this.onInvalid(channel.name, err),
      );
      if (message) handler(message);
    };

    let set = this.handlers.get(channel.name);
    if (!set) {
      set = new Set();
      this.handlers.set(channel.name, set);
      await subscriber.subscribe(channel.name);
    }
    set.add(wrapped);

    return async () => {
      set!.delete(wrapped);
      if (set!.size === 0) {
        this.handlers.delete(channel.name);
        await subscriber.unsubscribe(channel.name);
      }
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }
  }

  private ensureSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.publisher.duplicate();
      this.subscriber.on("message", (channelName: string, payload: string) => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch (err) {
          this.onInvalid(channelName, err);
          return;
        }
        for (const handler of this.handlers.get(channelName) ?? []) {
          handler(raw);
        }
      });
    }
    return this.subscriber;
  }
}
