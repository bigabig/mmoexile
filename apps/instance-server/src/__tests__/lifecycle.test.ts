import { describe, it, expect, vi, afterEach } from "vitest";
import { entityExists, getAllEntities } from "bitecs";
import { ZONES } from "@mmoexile/game-core";
import { InstanceHost } from "../cluster/index.js";
import type { ChatPayload } from "../cluster/index.js";

const golemPortal = (sourceInstanceId: string) => ({
  sourceInstanceId,
  portalId: "portal_to_dungeon_1",
});

describe("Instance lifecycle", () => {
  it("closes a dungeon once it has been empty longer than its timeout", () => {
    let clock = 0;
    const host = new InstanceHost({ now: () => clock, sweepIntervalMs: 0 });
    const { instanceId: nexusId } = host.registerPlayer({
      playerId: "a",
      name: "A",
    });
    host.transferPlayer("a", "golem_dungeon", golemPortal(nexusId));
    const dungeon = host.getInstanceForPlayer("a")!;

    clock = 10_000;
    host.transferPlayer("a", "nexus");
    // Captured after the player left: their old entity ID was already
    // recycled for their new nexus entity.
    const dungeonEntities = getAllEntities(dungeon.world.ecsWorld);
    expect(dungeonEntities.length).toBeGreaterThan(0);
    expect(dungeon.state).toBe("empty");
    expect(dungeon.emptySince).toBe(10_000);

    // Just before the timeout: still alive
    clock = 10_000 + ZONES.golem_dungeon.emptyTimeoutSec * 1000 - 1;
    expect(host.sweepIdleInstances()).toEqual([]);
    expect(host.getInstance(dungeon.id)).toBe(dungeon);

    // At the timeout: closed, forgotten, and its entity IDs released
    clock += 1;
    expect(host.sweepIdleInstances()).toEqual([dungeon]);
    expect(dungeon.state).toBe("closed");
    expect(host.getInstance(dungeon.id)).toBeUndefined();
    const nexus = host.getInstanceForPlayer("a")!;
    expect(
      dungeonEntities.filter((eid) => entityExists(nexus.world.ecsWorld, eid)),
    ).toEqual([]);
    host.stop();
  });

  it("does not close instances while players are inside", () => {
    let clock = 0;
    const host = new InstanceHost({ now: () => clock, sweepIntervalMs: 0 });
    const { instanceId } = host.registerPlayer({ playerId: "a", name: "A" });

    clock = 24 * 3600 * 1000;
    host.sweepIdleInstances();

    expect(host.getInstance(instanceId)?.state).toBe("running");
    host.stop();
  });

  it("keeps the warm nexus but closes extra empty shards", () => {
    let clock = 0;
    const host = new InstanceHost({ now: () => clock, sweepIntervalMs: 0 });
    const warm = host.getInstancesForZone("nexus")[0];
    const extra = host.createInstance("nexus");

    clock = ZONES.nexus.emptyTimeoutSec * 1000 + 1;
    host.sweepIdleInstances();

    expect(host.getInstancesForZone("nexus")).toHaveLength(1);
    // The oldest empty shard closes first; one stays warm.
    expect(extra.state === "closed" || warm.state === "closed").toBe(true);
    host.stop();
  });

  it("re-enters a fresh dungeon after the old one timed out", () => {
    let clock = 0;
    const host = new InstanceHost({ now: () => clock, sweepIntervalMs: 0 });
    const { instanceId: nexusId } = host.registerPlayer({
      playerId: "a",
      name: "A",
    });
    host.transferPlayer("a", "golem_dungeon", golemPortal(nexusId));
    const first = host.getInstanceForPlayer("a")!;
    host.transferPlayer("a", "nexus");

    clock = ZONES.golem_dungeon.emptyTimeoutSec * 1000;
    host.sweepIdleInstances();
    host.transferPlayer("a", "golem_dungeon", golemPortal(nexusId));

    const second = host.getInstanceForPlayer("a")!;
    expect(second.zone.id).toBe("golem_dungeon");
    expect(second.id).not.toBe(first.id);
    host.stop();
  });
});

describe("Lifecycle sweeper timer", () => {
  afterEach(() => vi.useRealTimers());

  it("closes idle instances on its own once per second", () => {
    vi.useFakeTimers();
    let clock = 0;
    const host = new InstanceHost({ now: () => clock });
    const { instanceId: nexusId } = host.registerPlayer({
      playerId: "a",
      name: "A",
    });
    host.transferPlayer("a", "golem_dungeon", golemPortal(nexusId));
    const dungeon = host.getInstanceForPlayer("a")!;
    host.transferPlayer("a", "nexus");

    clock = ZONES.golem_dungeon.emptyTimeoutSec * 1000;
    vi.advanceTimersByTime(1000);

    expect(dungeon.state).toBe("closed");
    expect(host.getInstance(dungeon.id)).toBeUndefined();
    host.stop();
  });
});

describe("Per-instance fault isolation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes only the crashing instance and moves its players to the nexus", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    const chat: ChatPayload[] = [];
    host.messageBus.onChat((payload) => chat.push(payload));

    const { instanceId: nexusId } = host.registerPlayer({
      playerId: "victim",
      name: "Victim",
    });
    host.registerPlayer({ playerId: "bystander", name: "Bystander" });
    host.transferPlayer("victim", "golem_dungeon", golemPortal(nexusId));
    const dungeon = host.getInstanceForPlayer("victim")!;
    const nexus = host.getInstance(nexusId)!;

    dungeon.world.tick = () => {
      throw new Error("boom");
    };
    const nexusTickBefore = nexus.world.currentTick;
    vi.advanceTimersByTime(200);

    expect(dungeon.state).toBe("crashed");
    expect(host.getInstance(dungeon.id)).toBeUndefined();
    expect(host.getInstanceForPlayer("victim")?.zone.id).toBe("nexus");
    expect(host.getInstanceForPlayer("bystander")!.id).toBe(nexusId);
    // The nexus kept ticking
    expect(nexus.world.currentTick).toBeGreaterThan(nexusTickBefore);
    expect(
      chat.some(
        (c) =>
          c.targetPlayerIds?.includes("victim") &&
          !c.targetPlayerIds.includes("bystander"),
      ),
    ).toBe(true);
    host.stop();
  });
});
