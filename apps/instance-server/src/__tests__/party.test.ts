import { describe, it, expect } from "vitest";
import { PartyService, type PartyChange } from "../party/PartyService.js";
import { ChatCommands } from "../chat/ChatCommands.js";
import { InstanceHost, type ChatPayload } from "../cluster/index.js";

describe("PartyService", () => {
  it("forms a party on accept with the inviter as leader", () => {
    const parties = new PartyService();
    const changes: PartyChange[] = [];
    parties.onChange((c) => changes.push(c));

    expect(parties.invite("a", "b")).toEqual({ ok: true });
    expect(parties.getPartyId("a")).toBeUndefined();

    const result = parties.accept("b");
    expect(result.ok).toBe(true);
    const party = parties.getParty("a")!;
    expect(party.leaderId).toBe("a");
    expect(party.members).toEqual(["a", "b"]);
    expect(parties.getPartyId("b")).toBe(party.id);
    expect(changes).toHaveLength(1);
  });

  it("rejects self-invites, members of other parties, and full parties", () => {
    const parties = new PartyService({ maxSize: 2 });
    expect(parties.invite("a", "a").ok).toBe(false);

    parties.invite("a", "b");
    parties.accept("b");
    expect(parties.invite("c", "b").ok).toBe(false);
    expect(parties.invite("a", "c")).toMatchObject({ ok: false });
  });

  it("expires invites", () => {
    let clock = 0;
    const parties = new PartyService({ inviteTtlMs: 1000, now: () => clock });
    parties.invite("a", "b");
    clock = 1000;
    expect(parties.accept("b")).toMatchObject({ ok: false });
  });

  it("hands leadership on and disbands a party of one", () => {
    const parties = new PartyService();
    parties.invite("a", "b");
    parties.accept("b");
    parties.invite("a", "c");
    parties.accept("c");

    const afterLeader = parties.leave("a")!;
    expect(afterLeader.party!.leaderId).toBe("b");
    expect(afterLeader.removed).toEqual(["a"]);

    const disband = parties.leave("b")!;
    expect(disband.party).toBeNull();
    expect(disband.removed.sort()).toEqual(["b", "c"]);
    expect(parties.getPartyId("c")).toBeUndefined();
  });
});

describe("Party chat commands and shared instances", () => {
  function setup() {
    const parties = new PartyService();
    const host = new InstanceHost({
      sweepIntervalMs: 0,
      getPartyId: (id) => parties.getPartyId(id),
    });
    const commands = new ChatCommands(host, parties);
    const chat: ChatPayload[] = [];
    host.messageBus.onChat((c) => chat.push(c));
    const { instanceId: nexusId } = host.registerPlayer({
      playerId: "alice",
      name: "Alice",
    });
    host.registerPlayer({ playerId: "bob", name: "Bob" });
    const told = (id: string) =>
      chat.filter((c) => c.targetPlayerIds?.includes(id)).map((c) => c.text);
    return { parties, host, commands, nexusId, told };
  }

  const viaPortal = (sourceInstanceId: string) => ({
    sourceInstanceId,
    portalId: "portal_to_dungeon_1",
  });

  it("/invite and /accept form a party, and members share the golem dungeon", () => {
    const { parties, host, commands, nexusId, told } = setup();

    expect(commands.handle("alice", "/invite bob")).toBe(true);
    expect(told("bob").at(-1)).toMatch(/Alice invited you/);
    commands.handle("bob", "/accept");
    expect(parties.getPartyId("alice")).toBe(parties.getPartyId("bob"));
    expect(told("alice").at(-1)).toMatch(/Bob joined the party/);

    host.transferPlayer("alice", "golem_dungeon", viaPortal(nexusId));
    host.transferPlayer("bob", "golem_dungeon", viaPortal(nexusId));
    const dungeon = host.getInstanceForPlayer("alice")!;
    expect(host.getInstanceForPlayer("bob")!.id).toBe(dungeon.id);
    expect(dungeon.ownerPartyId).toBe(parties.getPartyId("alice"));
    host.stop();
  });

  it("matches names case-insensitively and reports unknown players", () => {
    const { commands, parties, told } = setup();
    commands.handle("alice", "/invite BOB");
    commands.handle("bob", "/accept");
    expect(parties.getPartyId("bob")).toBeDefined();

    commands.handle("alice", "/invite Carol");
    expect(told("alice").at(-1)).toMatch(/No player named Carol/);
  });

  it("/party lists members and /leave disbands a party of two", () => {
    const { commands, parties, told } = setup();
    commands.handle("alice", "/invite Bob");
    commands.handle("bob", "/accept");

    commands.handle("bob", "/party");
    expect(told("bob").at(-1)).toBe("Party (2/6): Alice (leader), Bob");

    commands.handle("bob", "/leave");
    expect(parties.getPartyId("alice")).toBeUndefined();
    expect(told("alice").at(-1)).toMatch(/disbanded/);
  });

  it("does not treat normal chat as a command", () => {
    const { commands } = setup();
    expect(commands.handle("alice", "hello /invite")).toBe(false);
  });
});

describe("Chat scopes", () => {
  function setup() {
    const parties = new PartyService();
    const host = new InstanceHost({
      sweepIntervalMs: 0,
      getPartyId: (id) => parties.getPartyId(id),
    });
    const commands = new ChatCommands(host, parties);
    const chat: ChatPayload[] = [];
    host.messageBus.onChat((c) => chat.push(c));
    const a = host.registerPlayer({ playerId: "alice", name: "Alice" });
    host.registerPlayer({ playerId: "bob", name: "Bob" });
    return { parties, host, commands, chat, nexusId: a.instanceId };
  }

  it("/g sends player chat to everyone", () => {
    const { commands, chat } = setup();
    commands.handle("alice", "/g hello world");
    expect(chat.at(-1)).toMatchObject({
      sender: "Alice",
      text: "hello world",
      kind: "player",
      channel: "global",
    });
    expect(chat.at(-1)?.targetPlayerIds).toBeUndefined();
    expect(chat.at(-1)?.targetInstanceId).toBeUndefined();
  });

  it("/p sends player chat to party members only", () => {
    const { commands, chat } = setup();
    commands.handle("alice", "/p anyone?");
    expect(chat.at(-1)?.text).toMatch(/not in a party/);

    commands.handle("alice", "/invite Bob");
    commands.handle("bob", "/accept");
    commands.handle("bob", "/p hi team");
    expect(chat.at(-1)).toMatchObject({
      sender: "Bob",
      channel: "party",
      targetPlayerIds: ["alice", "bob"],
    });
  });

  it("announces zone entries only inside the entered instance", () => {
    const { host, chat, nexusId } = setup();
    host.transferPlayer("alice", "overworld");
    const overworld = host.getInstanceForPlayer("alice")!;
    const entry = chat.find((c) => c.text === "Alice entered Realm of the Ancients");
    expect(entry?.targetInstanceId).toBe(overworld.id);
    expect(entry?.targetInstanceId).not.toBe(nexusId);
    host.stop();
  });
});
