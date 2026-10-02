import { describe, it, expect } from "vitest";
import { ZONES, type ZoneId } from "@mmoexile/game-core";
import type { Instance } from "../cluster/Instance.js";
import {
  InstanceManager,
  type CreateInstanceOptions,
  type InstancePool,
} from "../cluster/InstanceManager.js";

/** In-memory pool of fake instances; no GameWorld is created. */
class FakePool implements InstancePool {
  public instances: Instance[] = [];
  private nextId = 1;

  getInstancesForZone(zoneId: ZoneId): Instance[] {
    return this.instances.filter((i) => i.zone.id === zoneId);
  }

  createInstance(zoneId: ZoneId, options: CreateInstanceOptions = {}) {
    const instance = {
      id: `${zoneId}:${String(this.nextId++).padStart(6, "0")}`,
      zone: ZONES[zoneId],
      players: new Set<string>(),
      ownerPartyId: options.ownerPartyId,
      boundPortalKey: options.boundPortalKey,
      state: "empty",
      createdAt: 0,
    } as unknown as Instance;
    this.instances.push(instance);
    return instance;
  }

  fill(instance: Instance, count: number): void {
    for (let i = 0; i < count; i++) {
      instance.players.add(`${instance.id}-p${i}`);
    }
  }
}

const nexusCaps = ZONES.nexus.access as { softCap: number; hardCap: number };

describe("InstanceManager: public_sharded", () => {
  it("creates the first shard on demand and reuses it", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);

    const first = manager.resolve({ zoneId: "nexus", characterId: "c1" });
    const second = manager.resolve({ zoneId: "nexus", characterId: "c2" });

    expect(second).toBe(first);
    expect(pool.instances).toHaveLength(1);
  });

  it("fills the most populated shard that is still below the soft cap", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);
    const quiet = pool.createInstance("nexus");
    const busy = pool.createInstance("nexus");
    pool.fill(quiet, 3);
    pool.fill(busy, nexusCaps.softCap - 1);

    expect(manager.resolve({ zoneId: "nexus", characterId: "c" })).toBe(busy);
  });

  it("opens a new shard when every shard is at the soft cap", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);
    pool.fill(pool.createInstance("nexus"), nexusCaps.softCap);

    const placed = manager.resolve({ zoneId: "nexus", characterId: "c" });

    expect(pool.instances).toHaveLength(2);
    expect(placed.players.size).toBe(0);
  });

  it("honors a preferred shard up to the hard cap", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);
    const friendTown = pool.createInstance("nexus");
    pool.fill(friendTown, nexusCaps.softCap + 5);

    expect(
      manager.resolve({
        zoneId: "nexus",
        characterId: "c",
        preferInstanceId: friendTown.id,
      }),
    ).toBe(friendTown);

    pool.fill(friendTown, nexusCaps.hardCap);
    expect(
      manager.resolve({
        zoneId: "nexus",
        characterId: "c",
        preferInstanceId: friendTown.id,
      }),
    ).not.toBe(friendTown);
  });

  it("never places players in closed instances", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);
    const closed = pool.createInstance("nexus");
    closed.state = "closed";

    expect(manager.resolve({ zoneId: "nexus", characterId: "c" })).not.toBe(
      closed,
    );
  });
});

describe("InstanceManager: party_private", () => {
  it("gives solo players their own instance", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);

    const a = manager.resolve({ zoneId: "golem_dungeon", characterId: "a" });
    const b = manager.resolve({ zoneId: "golem_dungeon", characterId: "b" });
    const aAgain = manager.resolve({
      zoneId: "golem_dungeon",
      characterId: "a",
    });

    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);
    expect(a.ownerPartyId).toBe("solo:a");
  });

  it("puts party members into the same instance", () => {
    const pool = new FakePool();
    const manager = new InstanceManager(pool);

    const a = manager.resolve({
      zoneId: "golem_dungeon",
      characterId: "a",
      partyId: "party_1",
    });
    const b = manager.resolve({
      zoneId: "golem_dungeon",
      characterId: "b",
      partyId: "party_1",
    });

    expect(b).toBe(a);
    expect(a.ownerPartyId).toBe("party_1");
  });
});

describe("InstanceManager: portal_bound", () => {
  // No zone uses portal_bound yet (see Open Decision D1), so test it with a
  // temporarily reconfigured zone.
  function withPortalBoundDungeon(run: () => void) {
    const original = ZONES.golem_dungeon.access;
    ZONES.golem_dungeon.access = { kind: "portal_bound" };
    try {
      run();
    } finally {
      ZONES.golem_dungeon.access = original;
    }
  }

  it("shares one instance per portal, separately per source instance", () => {
    withPortalBoundDungeon(() => {
      const pool = new FakePool();
      const manager = new InstanceManager(pool);
      const viaA = { sourceInstanceId: "overworld:aaaaaa", portalId: "p1" };
      const viaB = { sourceInstanceId: "overworld:bbbbbb", portalId: "p1" };

      const first = manager.resolve({
        zoneId: "golem_dungeon",
        characterId: "a",
        via: viaA,
      });
      const sameDoor = manager.resolve({
        zoneId: "golem_dungeon",
        characterId: "b",
        via: viaA,
      });
      const otherOverworld = manager.resolve({
        zoneId: "golem_dungeon",
        characterId: "c",
        via: viaB,
      });

      expect(sameDoor).toBe(first);
      expect(otherOverworld).not.toBe(first);
      expect(first.boundPortalKey).toBe("overworld:aaaaaa/p1");
    });
  });

  it("refuses entry without a portal", () => {
    withPortalBoundDungeon(() => {
      const manager = new InstanceManager(new FakePool());
      expect(() =>
        manager.resolve({ zoneId: "golem_dungeon", characterId: "a" }),
      ).toThrow(/portal_bound/);
    });
  });
});
