import { expect, it } from "vitest";
import { parsePingOutput } from "../../src/main/networkProbe";

it("computes RTT percentiles and ICMP loss from real replies only", () => {
  const m = parsePingOutput('64 bytes: time=1.0 ms\n64 bytes: time=3.0 ms\n3 packets transmitted, 2 packets received, 33.3% packet loss', 3);
  expect(m).toMatchObject({ packetsSent: 3, packetsReceived: 2, packetsLost: 1, rttSamples: 2, latencyMs: { min: 1, avg: 2, max: 3, p95: 3, p99: 3 } });
  expect(m.packetLossPercent).toBeCloseTo(100 / 3);
});
it("marks all ICMP loss and unsupported output without inventing RTT", () => {
  const m = parsePingOutput('2 packets transmitted, 0 received, 100% packet loss', 2);
  expect(m.packetLossPercent).toBe(100);
  expect(m.latencyMs).toBeUndefined();
  expect(m.errors.length).toBe(1);
  expect(parsePingOutput('unknown host', 2).packetsSent).toBeUndefined();
});
it("handles localized Windows ping and labels time resolution upper bounds", () => {
  const m = parsePingOutput('来自 127.0.0.1 的回复: 字节=32 时间<1ms TTL=128\n已发送 = 1，已接收 = 1，丢失 = 0', 1);
  expect(m).toMatchObject({ rttUpperBoundMs: 1, packetsLost: 0, latencyMs: { avg: 1 } });
  expect(m.notes?.[0]).toContain('上界');
});
