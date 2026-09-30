import { describe, it, expect } from "vitest";
import {
  serializePacket,
  deserializePacket,
  C2S_JoinPacket,
} from "../packets.js";

describe("Packet Serialization", () => {
  it("serializes and deserializes packets with MessagePack correctly", () => {
    const joinPacket: C2S_JoinPacket = {
      type: "c2s_join",
      nickname: "Hero123",
      token: "test-token",
    };
    const binary = serializePacket(joinPacket);
    expect(binary).toBeInstanceOf(Uint8Array);

    const decoded = deserializePacket<C2S_JoinPacket>(binary);
    expect(decoded.type).toBe("c2s_join");
    expect(decoded.nickname).toBe("Hero123");
    expect(decoded.token).toBe("test-token");
  });
});
