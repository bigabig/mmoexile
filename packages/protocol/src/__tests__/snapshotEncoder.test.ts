import { describe, it, expect } from "vitest";
import { deserializePacket, serializePacket, SnapshotEncoder, type EntityState, type S2C_SnapshotPacket } from "../index.js";

const entity = (i: number): EntityState => ({
  id: `entity-${i}-${"x".repeat(i % 7)}`,
  type: i % 3 === 0 ? "player" : "monster",
  subtype: "slime",
  x: i * 1.25,
  y: -i / 3,
  vx: 0,
  vy: 0.5,
  angle: Math.PI / (i + 1),
  hp: 100 - i,
  maxHp: 100,
  name: `Name ${i} ✨`,
  level: i,
  isAlive: true,
  equipment: { weapon: i % 2 ? "staff_fire" : null, armor: null },
  inventory: i % 3 === 0 ? ["sword_iron", null, null] : undefined,
});

describe("SnapshotEncoder", () => {
  it("produces exactly the bytes of serializePacket, for any entity count", () => {
    const shared = Array.from({ length: 70_000 }, (_, i) => entity(i % 500));
    for (const count of [0, 1, 15, 16, 300, 65_535, 65_536, 70_000]) {
      const packet: S2C_SnapshotPacket = {
        type: "s2c_snapshot",
        tick: 123456,
        serverTime: 1_790_000_000_123,
        lastAckSeq: count,
        entities: shared.slice(0, count),
      };
      const encoder = new SnapshotEncoder();
      expect(Buffer.from(encoder.encode(packet)).equals(Buffer.from(serializePacket(packet)))).toBe(true);
    }
  });

  it("reuses encoded entities across players of one tick", () => {
    const entities = Array.from({ length: 50 }, (_, i) => entity(i));
    const encoder = new SnapshotEncoder();
    const forPlayer = (seq: number, visible: EntityState[]) =>
      deserializePacket<S2C_SnapshotPacket>(
        encoder.encode({ type: "s2c_snapshot", tick: 1, serverTime: 2, lastAckSeq: seq, entities: visible }),
      );
    expect(forPlayer(1, entities.slice(0, 30)).entities).toHaveLength(30);
    const second = forPlayer(7, entities.slice(10, 50));
    expect(second.lastAckSeq).toBe(7);
    const plain = deserializePacket<S2C_SnapshotPacket>(
      serializePacket({ type: "s2c_snapshot", tick: 1, serverTime: 2, lastAckSeq: 7, entities: entities.slice(10, 50) }),
    );
    expect(second).toEqual(plain);
  });
});
