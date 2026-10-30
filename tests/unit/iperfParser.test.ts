import { describe, expect, it } from "vitest";
import { buildIperfArgs, extractEndMetrics, intervalUpdate } from "../../src/main/iperfRunner";

describe("buildIperfArgs", () => {
  it("uses --json-stream for tcp upload", () => {
    const args = buildIperfArgs({ host: "10.0.0.1", phaseKind: "tcp-upload", durationSeconds: 5 });
    expect(args).toEqual(["-c", "10.0.0.1", "--json-stream", "-t", "5"]);
  });

  it("adds -R for tcp download", () => {
    const args = buildIperfArgs({ host: "10.0.0.1", phaseKind: "tcp-download", durationSeconds: 5 });
    expect(args).toContain("-R");
    expect(args).toContain("--json-stream");
  });

  it("adds -u -b for udp", () => {
    const args = buildIperfArgs({ host: "10.0.0.1", phaseKind: "udp-quality", durationSeconds: 5, targetBitrateMbps: 8 });
    expect(args).toContain("-u");
    expect(args).toContain("8M");
  });
});

describe("intervalUpdate", () => {
  it("derives a tcp interval update from interval data", () => {
    const u = intervalUpdate("tcp-upload", { sum: { start: 1, end: 2, bits_per_second: 100_000_000 } });
    expect(u).toEqual({ phaseKind: "tcp-upload", second: 2, startSeconds: 1, endSeconds: 2, side: "sender", throughputMbps: 100 });
  });

  it("includes loss and jitter for udp interval data", () => {
    const u = intervalUpdate("udp-quality", {
      sum: { sender: false, start: 4, end: 5, bits_per_second: 8_000_000, lost_percent: 1.5, jitter_ms: 0.3 }
    });
    expect(u).toEqual({ phaseKind: "udp-quality", second: 5, startSeconds: 4, endSeconds: 5, side: "receiver", throughputMbps: 8, udpLossPercent: 1.5, jitterMs: 0.3 });
  });

  it("returns null when interval data lacks a numeric throughput", () => {
    expect(intervalUpdate("tcp-upload", { sum: { start: 0, end: 1 } })).toBeNull();
  });
});

describe("extractEndMetrics", () => {
  it("reads tcp throughput from the end event data", () => {
    const m = extractEndMetrics("tcp-upload", { sum_received: { bits_per_second: 943_000_000 } });
    expect(m.phaseId).toBe("tcp-upload");
    expect(m.throughputMbps).toBeCloseTo(943, 0);
    expect(m.errors).toEqual([]);
  });

  it("reads udp loss and jitter from the end event data", () => {
    const m = extractEndMetrics("udp-quality", {
      sum: { bits_per_second: 8_000_000, lost_percent: 0.5, jitter_ms: 0.2 }
    });
    expect(m.throughputMbps).toBeCloseTo(8, 1);
    expect(m.udpLossPercent).toBe(0.5);
    expect(m.jitterMs).toBe(0.2);
  });

  it("returns an error metric when the end data is missing", () => {
    const m = extractEndMetrics("tcp-upload", undefined);
    expect(m.errors).toEqual(["Missing iperf3 end event."]);
  });
});

 it("uses receiver throughput and sender retransmits, retaining measured zeros", () => {
   const m = extractEndMetrics("tcp-download", { sum_sent: { bits_per_second: 100_000_000, retransmits: 0 }, sum_received: { bits_per_second: 90_000_000, bytes: 100, seconds: 2 } });
   expect(m).toMatchObject({ throughputMbps: 90, senderMbps: 100, retransmits: 0, bytesReceived: 100, durationSeconds: 2 });
 });
 it("prefers receiver UDP metrics over legacy sender sum", () => {
   const m = extractEndMetrics("udp-quality", { sum: { bits_per_second: 8_000_000, sender: true }, sum_received: { bits_per_second: 7_000_000, packets: 100, lost_packets: 5, lost_percent: 5, jitter_ms: 2 } });
   expect(m).toMatchObject({ throughputMbps: 7, packetsSent: 100, packetsReceived: 95, packetsLost: 5, udpLossPercent: 5, jitterMs: 2 });
 });
 it("does not invent receiver metrics from a sender-only summary", () => {
   expect(extractEndMetrics("tcp-upload", { sum_sent: { bits_per_second: 10 } }).errors.length).toBe(1);
   expect(extractEndMetrics("udp-quality", { sum: { bits_per_second: 10, sender: true } }).errors.length).toBe(1);
 });

it("runs UDP download in reverse and parses receiver metrics", () => {
  expect(buildIperfArgs({ host: "127.0.0.1", phaseKind: "udp-download", durationSeconds: 5, targetBitrateMbps: 8 }))
    .toEqual(["-c", "127.0.0.1", "--json-stream", "-t", "5", "-R", "-u", "-b", "8M"]);
  expect(extractEndMetrics("udp-download", { sum_received: { bits_per_second: 7_000_000, packets: 100, lost_packets: 1, lost_percent: 1, jitter_ms: .1 } }))
    .toMatchObject({ throughputMbps: 7, packetsReceived: 99, udpLossPercent: 1 });
});
