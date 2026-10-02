import { describe, it, expect, vi } from "vitest";
import { Position } from "@mmoexile/game-core";
import { InstanceHost, type CharacterPersistence } from "../cluster/index.js";

const portal = (sourceInstanceId: string) => ({
  sourceInstanceId,
  portalId: "portal_to_dungeon_1",
});

function recordingPersistence() {
  const calls: string[] = [];
  const persistence: CharacterPersistence = {
    queueSave: (id) => void calls.push(`queue:${id}`),
    saveImmediate: async (id) => void calls.push(`save:${id}`),
    handleDeath: async (id) => void calls.push(`death:${id}`),
  };
  return { calls, persistence };
}

describe("InstanceHost options for the instance server", () => {
  it("saves through the injected persistence on disconnect", () => {
    const { calls, persistence } = recordingPersistence();
    const host = new InstanceHost({ sweepIntervalMs: 0, persistence });
    host.registerPlayer({ playerId: "a", name: "A" });

    host.unregisterPlayer("a");

    expect(calls).toEqual(["save:a"]);
    host.stop();
  });

  it("detaches a player without saving and returns their state", () => {
    const { calls, persistence } = recordingPersistence();
    const host = new InstanceHost({ sweepIntervalMs: 0, persistence });
    const { instanceId } = host.registerPlayer({ playerId: "a", name: "A" });

    const detached = host.detachPlayer("a");

    expect(detached?.charId).toBe("a");
    expect(detached?.state.lastZoneId).toBe("nexus");
    expect(calls).toEqual([]);
    expect(host.getInstanceForPlayer("a")).toBeUndefined();
    expect(host.getInstance(instanceId)!.players.size).toBe(0);
    host.stop();
  });

  it("enters private zones only with an authorized entry", () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });

    const login = host.registerPlayer({ playerId: "a", name: "A", zoneId: "golem_dungeon" });
    expect(login.zoneId).toBe("nexus");

    const ticketed = host.registerPlayer({
      playerId: "b",
      name: "B",
      zoneId: "golem_dungeon",
      allowPrivateZones: true,
      partyId: "party_x",
      via: portal("overworld:abc123"),
    });
    expect(ticketed.zoneId).toBe("golem_dungeon");
    expect(host.getInstance(ticketed.instanceId)!.ownerPartyId).toBe("party_x");
    host.stop();
  });

  it("enters the instance named on the ticket, or recreates one if it is gone", () => {
    const host = new InstanceHost({ sweepIntervalMs: 0 });
    const allocated = host.createInstance("overworld", { id: "overworld:a110c8" });
    const entered = host.registerPlayer({
      playerId: "a",
      name: "A",
      zoneId: "overworld",
      instanceId: "overworld:a110c8",
    });
    expect(entered.instanceId).toBe(allocated.id);

    // Closed in the meantime: local placement for the same zone takes over
    const gone = host.registerPlayer({
      playerId: "b",
      name: "B",
      zoneId: "overworld",
      instanceId: "overworld:999999",
    });
    expect(gone.zoneId).toBe("overworld");
    expect(gone.instanceId).not.toBe("overworld:999999");
    host.stop();
  });

  it("hands portal use to onPortalTransfer instead of moving in memory", () => {
    vi.useFakeTimers();
    const onPortalTransfer = vi.fn();
    const host = new InstanceHost({ sweepIntervalMs: 0, onPortalTransfer });
    const { instanceId, playerEid } = host.registerPlayer({ playerId: "a", name: "A" });
    const instance = host.getInstance(instanceId)!;

    // Stand next to the nexus portal (20, 9) and interact
    Position.x[playerEid] = 20;
    Position.y[playerEid] = 9.5;
    instance.world.enqueueCommand("a", { type: "interact" });
    vi.advanceTimersByTime(40);

    expect(onPortalTransfer).toHaveBeenCalledWith("a", "overworld", {
      sourceInstanceId: instanceId,
      portalId: "portal_to_overworld",
    });
    expect(host.getInstanceForPlayer("a")!.id).toBe(instanceId);
    host.stop();
    vi.useRealTimers();
  });
});
