import { describe, it, expect } from "vitest";
import { entityExists, getAllEntities } from "bitecs";
import { STATIC_MAPS, Health, Position } from "@mmoexile/game-core";
import { GameWorld } from "../GameWorld.js";

/**
 * bitECS component data lives in module-level arrays (e.g. Health.current[eid]),
 * so every GameWorld in a process shares the same storage. These tests guard
 * against two worlds handing out the same entity ID and overwriting each
 * other's component data.
 */
describe("Entity isolation between GameWorlds in one process", () => {
  it("never hands out the same entity ID in two worlds", () => {
    const a = new GameWorld("iso_a", STATIC_MAPS.nexus());
    const b = new GameWorld("iso_b", STATIC_MAPS.realm_1());

    const idsA = new Set(getAllEntities(a.ecsWorld));
    const idsB = getAllEntities(b.ecsWorld);

    expect(idsA.size).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
    expect(idsB.filter((eid) => idsA.has(eid))).toEqual([]);

    a.destroy();
    b.destroy();
  });

  it("keeps component data of one world unaffected by another", () => {
    const a = new GameWorld("iso_a", STATIC_MAPS.nexus());
    const eidA = a.addPlayer({
      id: "player_a",
      name: "Alice",
      classId: "wizard",
      hp: 42,
      x: 10,
      y: 10,
    });

    const b = new GameWorld("iso_b", STATIC_MAPS.nexus());
    const eidB = b.addPlayer({
      id: "player_b",
      name: "Bob",
      classId: "wizard",
      hp: 77,
      x: 20,
      y: 20,
    });

    expect(eidB).not.toBe(eidA);
    expect(Health.current[eidA]).toBe(42);
    expect(Position.x[eidA]).toBe(10);
    expect(Health.current[eidB]).toBe(77);

    a.destroy();
    b.destroy();
  });

  it("releases all entity IDs when a world is destroyed", () => {
    const a = new GameWorld("iso_a", STATIC_MAPS.realm_1());
    const b = new GameWorld("iso_b", STATIC_MAPS.nexus());
    const idsA = getAllEntities(a.ecsWorld);
    expect(idsA.length).toBeGreaterThan(0);

    a.destroy();

    // The shared entity index no longer considers A's entities alive...
    expect(idsA.filter((eid) => entityExists(b.ecsWorld, eid))).toEqual([]);
    // ...while B's entities are untouched.
    const idsB = getAllEntities(b.ecsWorld);
    expect(idsB.every((eid) => entityExists(b.ecsWorld, eid))).toBe(true);

    b.destroy();
  });
});
