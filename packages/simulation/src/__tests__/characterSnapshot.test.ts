import { describe, it, expect } from "vitest";
import { ZONES } from "@mmoexile/game-core";
import { GameWorld } from "../GameWorld.js";
import {
  snapshotCharacter,
  spawnOptionsFromSnapshot,
  persistenceFromSnapshot,
} from "../snapshot/characterSnapshot.js";

describe("Character snapshots", () => {
  function spawnHero(world: GameWorld) {
    world.addPlayer({
      id: "hero",
      name: "Hero",
      classId: "knight",
      level: 7,
      xp: 1234,
      hp: 88,
      x: 12,
      y: 14,
      equipment: { weapon: "sword_iron", armor: "armor_iron" },
      inventory: ["staff_fire", null, "robe_magician", null, null, null, null, null],
    });
  }

  it("round-trips a character into another world without losing state", () => {
    const source = new GameWorld("nexus:aaaaaa", ZONES.nexus.createMap());
    const target = new GameWorld("overworld:bbbbbb", ZONES.overworld.createMap());
    spawnHero(source);

    const before = snapshotCharacter(source, "hero")!;
    target.addPlayer(spawnOptionsFromSnapshot(before, { x: 30, y: 50 }));
    const after = snapshotCharacter(target, "hero")!;

    expect(after).toEqual({
      ...before,
      x: 30,
      y: 50,
      zoneId: "overworld",
    });
    source.destroy();
    target.destroy();
  });

  it("returns null for unknown characters", () => {
    const world = new GameWorld("nexus:aaaaaa", ZONES.nexus.createMap());
    expect(snapshotCharacter(world, "nobody")).toBeNull();
    world.destroy();
  });

  it("persists the zone, not the instance, and leaves MP untouched", () => {
    const world = new GameWorld("nexus:aaaaaa", ZONES.nexus.createMap());
    spawnHero(world);

    const state = persistenceFromSnapshot(snapshotCharacter(world, "hero")!);

    expect(state.lastZoneId).toBe("nexus");
    expect(state).not.toHaveProperty("mp");
    expect(state.hp).toBe(88);
    expect(state.inventory![2]).toBe("robe_magician");
    expect(world.getPlayerPersistenceState("hero")).toEqual(state);
    world.destroy();
  });
});
