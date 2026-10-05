import { encode } from "@msgpack/msgpack";
import type { S2C_SnapshotPacket } from "./packets.js";
import type { EntityState } from "./snapshot.js";

/**
 * Encodes one tick's s2c_snapshot packets for all players of an instance,
 * encoding each entity only once. Players near each other see mostly the
 * same entities (the same EntityState objects), so re-encoding them per
 * player was most of a busy server's CPU time.
 *
 * MessagePack is concatenative, so the result is byte-for-byte what
 * `serializePacket(packet)` produces: clients notice no difference.
 * Use one encoder per tick: it caches by object identity.
 */
export class SnapshotEncoder {
  private readonly entities = new Map<EntityState, Uint8Array>();
  private readonly entitiesKey = encode("entities");

  encode(packet: S2C_SnapshotPacket): Uint8Array {
    // The packet without its entities: a map with 4 entries…
    const head = encode({
      type: packet.type,
      tick: packet.tick,
      serverTime: packet.serverTime,
      lastAckSeq: packet.lastAckSeq,
    });
    const parts: Uint8Array[] = [];
    let size = head.length + this.entitiesKey.length;
    for (const entity of packet.entities) {
      let bytes = this.entities.get(entity);
      if (!bytes) {
        bytes = encode(entity);
        this.entities.set(entity, bytes);
      }
      parts.push(bytes);
      size += bytes.length;
    }
    const arrayHeader = arrayHeaderFor(parts.length);
    size += arrayHeader.length;

    // …becomes a map with 5: "entities" → array of pre-encoded entities.
    const out = new Uint8Array(size);
    out.set(head, 0);
    out[0] = 0x85; // fixmap, 5 entries (head starts with 0x84)
    let offset = head.length;
    out.set(this.entitiesKey, offset);
    offset += this.entitiesKey.length;
    out.set(arrayHeader, offset);
    offset += arrayHeader.length;
    for (const bytes of parts) {
      out.set(bytes, offset);
      offset += bytes.length;
    }
    return out;
  }
}

function arrayHeaderFor(length: number): Uint8Array {
  if (length < 16) return Uint8Array.of(0x90 | length);
  if (length < 0x10000) return Uint8Array.of(0xdc, length >> 8, length & 0xff);
  return Uint8Array.of(0xdd, length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
}
