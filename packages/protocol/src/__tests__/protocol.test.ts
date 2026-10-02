import { describe, it, expect } from "vitest";
import {
  serializePacket,
  deserializePacket,
  C2S_HelloPacket,
} from "../packets.js";

describe("Packet Serialization", () => {
  it("serializes and deserializes packets with MessagePack correctly", () => {
    const helloPacket: C2S_HelloPacket = {
      type: "c2s_hello",
      ticket: "test-ticket",
      protocolVersion: 2,
    };
    const binary = serializePacket(helloPacket);
    expect(binary).toBeInstanceOf(Uint8Array);

    const decoded = deserializePacket<C2S_HelloPacket>(binary);
    expect(decoded.type).toBe("c2s_hello");
    expect(decoded.ticket).toBe("test-ticket");
    expect(decoded.protocolVersion).toBe(2);
  });
});
