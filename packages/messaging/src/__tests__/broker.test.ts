import { describe, it, expect, afterEach, vi } from "vitest";
import { channels } from "@mmoexile/contracts";
import { InMemoryBroker, RedisBroker, Redis, type Broker } from "../index.js";

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const implementations: [string, () => { broker: Broker; cleanup: () => Promise<void> }][] = [
  ["InMemoryBroker", () => {
    const broker = new InMemoryBroker();
    return { broker, cleanup: () => broker.close() };
  }],
  ["RedisBroker", () => {
    const redis = new Redis(process.env.TEST_REDIS_URL!);
    const broker = new RedisBroker({ redis, onInvalidMessage: () => {} });
    return { broker, cleanup: async () => { await broker.close(); await redis.quit(); } };
  }],
];

describe.each(implementations)("%s", (_name, create) => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => { await cleanup?.(); });

  it("delivers messages to every subscriber of a channel", async () => {
    const created = create(); cleanup = created.cleanup;
    const { broker } = created;
    const a: string[] = [], b: string[] = [];
    await broker.subscribe(channels.chatGlobal, (m) => a.push(m.text));
    await broker.subscribe(channels.chatGlobal, (m) => b.push(m.text));

    await broker.publish(channels.chatGlobal, { senderName: "Ann", text: "hi", kind: "player" });

    await until(() => a.length === 1 && b.length === 1);
    expect(a).toEqual(["hi"]);
  });

  it("keeps channels separate and stops after unsubscribe", async () => {
    const created = create(); cleanup = created.cleanup;
    const { broker } = created;
    const kicks: string[] = [], chats: string[] = [];
    const stop = await broker.subscribe(channels.sessionKick, (m) => kicks.push(m.characterId));
    await broker.subscribe(channels.chatGlobal, (m) => chats.push(m.text));

    await broker.publish(channels.sessionKick, { characterId: "c1", reason: "logged_in_elsewhere" });
    await until(() => kicks.length === 1);
    await stop();
    await broker.publish(channels.sessionKick, { characterId: "c2", reason: "logged_in_elsewhere" });
    await broker.publish(channels.chatGlobal, { senderName: "S", text: "marker", kind: "system" });
    await until(() => chats.length === 1);

    expect(kicks).toEqual(["c1"]);
  });
});

describe("RedisBroker validation", () => {
  it("drops messages that break the channel schema", async () => {
    const redis = new Redis(process.env.TEST_REDIS_URL!);
    const onInvalid = vi.fn();
    const broker = new RedisBroker({ redis, onInvalidMessage: onInvalid });
    const received: unknown[] = [];
    await broker.subscribe(channels.sessionKick, (m) => received.push(m));

    await redis.publish("session.kick", JSON.stringify({ characterId: 5 }));
    await redis.publish("session.kick", "not json");
    await until(() => onInvalid.mock.calls.length === 2);

    expect(received).toEqual([]);
    await broker.close();
    await redis.quit();
  });
});
