import type { Channel, ChannelMessage } from "@mmoexile/contracts";

export type Unsubscribe = () => Promise<void>;

/**
 * Publish/subscribe between services, typed by the channels in
 * @mmoexile/contracts. Delivery is fire-and-forget: subscribers that are
 * offline miss messages.
 */
export interface Broker {
  publish<C extends Channel>(
    channel: C,
    message: ChannelMessage<C>,
  ): Promise<void>;
  subscribe<C extends Channel>(
    channel: C,
    handler: (message: ChannelMessage<C>) => void,
  ): Promise<Unsubscribe>;
  close(): Promise<void>;
}

/** Validates an incoming message; invalid ones are reported and dropped. */
export function parseMessage<C extends Channel>(
  channel: C,
  raw: unknown,
  onInvalid: (error: unknown) => void,
): ChannelMessage<C> | undefined {
  const result = channel.schema.safeParse(raw);
  if (!result.success) {
    onInvalid(result.error);
    return undefined;
  }
  return result.data as ChannelMessage<C>;
}

/** Single-process broker for tests and in-process setups. */
export class InMemoryBroker implements Broker {
  private handlers = new Map<string, Set<(raw: unknown) => void>>();

  async publish<C extends Channel>(
    channel: C,
    message: ChannelMessage<C>,
  ): Promise<void> {
    // Serialize like a real broker would, so tests catch non-JSON payloads.
    const raw = JSON.parse(JSON.stringify(message));
    for (const handler of this.handlers.get(channel.name) ?? []) {
      handler(raw);
    }
  }

  async subscribe<C extends Channel>(
    channel: C,
    handler: (message: ChannelMessage<C>) => void,
  ): Promise<Unsubscribe> {
    const wrapped = (raw: unknown) => {
      const message = parseMessage(channel, raw, (err) =>
        console.error(`[InMemoryBroker] Invalid ${channel.name} message`, err),
      );
      if (message) handler(message);
    };
    let set = this.handlers.get(channel.name);
    if (!set) {
      set = new Set();
      this.handlers.set(channel.name, set);
    }
    set.add(wrapped);
    return async () => {
      set!.delete(wrapped);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
