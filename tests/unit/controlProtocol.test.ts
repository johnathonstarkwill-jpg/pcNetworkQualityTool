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
    expect(decode('{"type":"test-complete","runId":"r1",')).toEqual([]);
    expect(decode('"clientId":"c1"}\n')).toEqual([{ type: "test-complete", runId: "r1", clientId: "c1" }]);
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

it("drops valid JSON with invalid shapes and keeps the next valid frame", () => {
  const decode = createDecoder();
  expect(decode('null\n{}\n{"type":"register-client"}\n{"type":"phase-result","clientId":"x","metrics":{}}\n{"type":"error","message":"ok"}\n'))
    .toEqual([{ type: "error", message: "ok" }]);
});

it("rejects overlong frames and recovers on the next newline", () => {
  const decode = createDecoder();
  expect(decode('x'.repeat(70_000))).toEqual([]);
  expect(decode('\n{"type":"error","message":"ok"}\n')).toEqual([{ type: "error", message: "ok" }]);
});

it("validates streamed intervals and signed RTT deltas at the network boundary", () => {
  const decode = createDecoder();
  const base = { type: "phase-progress", runId: "r", clientId: "c", phaseId: "tcp-upload" };
  const interval = { startSeconds: 0, endSeconds: 1, mbps: 10, side: "sender" };
  expect(decode(JSON.stringify({ ...base, interval }) + '\n')).toHaveLength(1);
  expect(decode(JSON.stringify({ ...base, interval: { ...interval, endSeconds: -1 } }) + '\n')).toEqual([]);
  const metrics = { phaseId: "tcp-upload", errors: [], loadedLatency: { rttSamples: 1, packetsSent: 1, packetsReceived: 1, packetsLost: 0, deltaAvgMs: -1, deltaP95Ms: -2, notes: [], errors: [] } };
  expect(decode(JSON.stringify({ type: "phase-result", runId: "r", clientId: "c", metrics }) + '\n')).toHaveLength(1);
  expect(decode(JSON.stringify({ type: "phase-result", runId: "r", clientId: "c", metrics: { ...metrics, loadedLatency: {} } }) + '\n')).toEqual([]);
});
