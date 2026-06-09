import { describe, expect, it } from "vitest";
import { CONTROL_PORT, createDecoder, encode } from "../../src/main/controlProtocol";
import type { ControlMessage } from "../../src/shared/types";

describe("controlProtocol", () => {
  it("exposes the fixed control port", () => {
    expect(CONTROL_PORT).toBe(48200);
  });

  it("encodes a message as one JSON line ending in newline", () => {
    const msg: ControlMessage = { type: "client-registered", clientId: "c1" };
    expect(encode(msg)).toBe('{"type":"client-registered","clientId":"c1"}\n');
  });

  it("decodes a single complete frame", () => {
    const decode = createDecoder();
    const msgs = decode('{"type":"client-registered","clientId":"c1"}\n');
    expect(msgs).toEqual([{ type: "client-registered", clientId: "c1" }]);
  });

  it("buffers a partial frame until the newline arrives", () => {
    const decode = createDecoder();
    expect(decode('{"type":"test-complete",')).toEqual([]);
    expect(decode('"clientId":"c1"}\n')).toEqual([{ type: "test-complete", clientId: "c1" }]);
  });

  it("decodes multiple coalesced frames in one chunk", () => {
    const decode = createDecoder();
    const chunk = '{"type":"error","message":"a"}\n{"type":"error","message":"b"}\n';
    expect(decode(chunk)).toEqual([
      { type: "error", message: "a" },
      { type: "error", message: "b" }
    ]);
  });

  it("discards malformed lines without throwing", () => {
    const decode = createDecoder();
    expect(decode('not json\n{"type":"error","message":"ok"}\n')).toEqual([
      { type: "error", message: "ok" }
    ]);
  });
});
