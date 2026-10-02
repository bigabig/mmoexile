import { describe, it, expect } from "vitest";
import { channels, type ChannelMessage } from "@mmoexile/contracts";
import { InMemoryBroker } from "@mmoexile/messaging";
import { InstanceHost, type ChatPayload } from "../cluster/index.js";
import { ChatCommands } from "../chat/ChatCommands.js";
import { InMemoryPartyDirectory } from "../party/PartyDirectory.js";
import { PartyCache } from "../party/PartyCache.js";
import { InMemoryPresence } from "../presence/Presence.js";

/** One instance server's worth of party wiring, all in memory. */
async function setup() {
  const broker = new InMemoryBroker();
  const parties = new InMemoryPartyDirectory(broker);
  const cache = new PartyCache(broker);
  await cache.start();
  const presence = new InMemoryPresence();
  const host = new InstanceHost({
    sweepIntervalMs: 0,
    getPartyId: (id) => cache.getPartyId(id),
  });
  const commands = new ChatCommands({ host, parties, presence, broker });

  const local: ChatPayload[] = [];
  const partyChat: ChannelMessage<typeof channels.chatParty>[] = [];
  const globalChat: ChannelMessage<typeof channels.chatGlobal>[] = [];
  host.messageBus.onChat((c) => local.push(c));
  await broker.subscribe(channels.chatParty, (m) => partyChat.push(m));
  await broker.subscribe(channels.chatGlobal, (m) => globalChat.push(m));

  const join = async (playerId: string, name: string) => {
    const registered = host.registerPlayer({ playerId, name });
    await presence.set(playerId, name);
    return registered;
  };
  const { instanceId: nexusId } = await join("alice", "Alice");
  await join("bob", "Bob");

  // Private replies and party notices, in arrival order
  const log: { to: string[]; text: string }[] = [];
  host.messageBus.onChat((c) => log.push({ to: c.targetPlayerIds ?? [], text: c.text }));
  await broker.subscribe(channels.chatParty, (m) => log.push({ to: m.memberIds, text: m.text }));
  /** The last private reply or party notice a player received. */
  const lastTold = (id: string) =>
    log.filter((entry) => entry.to.includes(id)).map((entry) => entry.text).at(-1);

  return { broker, parties, cache, host, commands, nexusId, partyChat, globalChat, lastTold };
}

const viaPortal = (sourceInstanceId: string) => ({
  sourceInstanceId,
  portalId: "portal_to_dungeon_1",
});

describe("PartyCache", () => {
  it("follows party.updated messages and seeds", async () => {
    const broker = new InMemoryBroker();
    const cache = new PartyCache(broker);
    await cache.start();

    cache.seed("x", { id: "p1", leaderId: "x", members: ["x", "y"] });
    expect(cache.getPartyId("y")).toBe("p1");

    await broker.publish(channels.partyUpdated, {
      partyId: "p1",
      party: null,
      removed: ["x", "y"],
    });
    expect(cache.getPartyId("x")).toBeUndefined();
    expect(cache.getParty("y")).toBeUndefined();
  });
});

describe("Party chat commands", () => {
  it("/invite and /accept form a party, and members share the golem dungeon", async () => {
    const { host, commands, cache, nexusId, lastTold } = await setup();

    await commands.run("alice", "/invite bob");
    expect(lastTold("bob")).toMatch(/Alice invited you/);
    await commands.run("bob", "/accept");
    expect(cache.getPartyId("alice")).toBeDefined();
    expect(cache.getPartyId("alice")).toBe(cache.getPartyId("bob"));
    expect(lastTold("alice")).toMatch(/Bob joined the party/);

    host.transferPlayer("alice", "golem_dungeon", viaPortal(nexusId));
    host.transferPlayer("bob", "golem_dungeon", viaPortal(nexusId));
    const dungeon = host.getInstanceForPlayer("alice")!;
    expect(host.getInstanceForPlayer("bob")!.id).toBe(dungeon.id);
    expect(dungeon.ownerPartyId).toBe(cache.getPartyId("alice"));
    host.stop();
  });

  it("matches names case-insensitively and reports unknown players", async () => {
    const { commands, cache, lastTold, host } = await setup();
    await commands.run("alice", "/invite BOB");
    await commands.run("bob", "/accept");
    expect(cache.getPartyId("bob")).toBeDefined();

    await commands.run("alice", "/invite Carol");
    expect(lastTold("alice")).toMatch(/No player named Carol/);
    host.stop();
  });

  it("/party lists members and /leave disbands a party of two", async () => {
    const { commands, cache, lastTold, host } = await setup();
    await commands.run("alice", "/invite Bob");
    await commands.run("bob", "/accept");

    await commands.run("bob", "/party");
    expect(lastTold("bob")).toBe("Party (2/6): Alice (leader), Bob");

    await commands.run("bob", "/leave");
    expect(cache.getPartyId("alice")).toBeUndefined();
    expect(lastTold("alice")).toMatch(/disbanded/);
    host.stop();
  });

  it("does not treat normal chat as a command", async () => {
    const { commands, host } = await setup();
    expect(commands.handle("alice", "hello /invite")).toBe(false);
    host.stop();
  });
});

describe("Shared chat channels", () => {
  it("/g publishes to everyone through the broker", async () => {
    const { commands, globalChat, host } = await setup();
    await commands.run("alice", "/g hello world");
    expect(globalChat.at(-1)).toEqual({
      senderName: "Alice",
      text: "hello world",
      kind: "player",
    });
    host.stop();
  });

  it("/p reaches party members only", async () => {
    const { commands, partyChat, lastTold, host } = await setup();
    await commands.run("alice", "/p anyone?");
    expect(lastTold("alice")).toMatch(/not in a party/);

    await commands.run("alice", "/invite Bob");
    await commands.run("bob", "/accept");
    await commands.run("bob", "/p hi team");
    expect(partyChat.at(-1)).toMatchObject({
      senderName: "Bob",
      kind: "player",
      memberIds: ["alice", "bob"],
    });
    host.stop();
  });

  it("announces zone entries only inside the entered instance", async () => {
    const { host } = await setup();
    const chat: ChatPayload[] = [];
    host.messageBus.onChat((c) => chat.push(c));
    host.transferPlayer("alice", "overworld");
    const overworld = host.getInstanceForPlayer("alice")!;
    const entry = chat.find(
      (c) => c.text === "Alice entered Realm of the Ancients",
    );
    expect(entry?.targetInstanceId).toBe(overworld.id);
    host.stop();
  });
});
