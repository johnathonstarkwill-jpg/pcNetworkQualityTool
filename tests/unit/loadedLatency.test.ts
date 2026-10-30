import { expect, it } from "vitest";
import { runWithLoadedLatency } from "../../src/main/loadedLatency";
import type { PhaseMetrics } from "../../src/shared/types";
import type { IperfExecutor } from "../../src/main/controlClient";
import type { runNetworkProbe } from "../../src/main/networkProbe";
const baseline: PhaseMetrics = { phaseId: "latency", rttSamples: 10, latencyMs: { min: 10, avg: 10, max: 10, p95: 10, p99: 10 }, errors: [] };
const input = { host: "127.0.0.1", phaseKind: "tcp-upload" as const, durationSeconds: 5 };
it("measures during data load, calculates signed increases and stops probing at completion", async () => {
  let probeCalls = 0;
  let loading = false;
  let finish!: () => void;
  const measured = new Promise<void>(r => { finish = r; });
  const exec: IperfExecutor = async (_, onInterval) => {
    expect(probeCalls).toBe(0);
    loading = true;
    onInterval?.({ phaseKind: "tcp-upload", second: 1, throughputMbps: 50 });
    await measured;
    loading = false;
    return { phaseId: "tcp-upload", throughputMbps: 50, errors: [] };
  };
  const probe: typeof runNetworkProbe = async () => {
    expect(loading).toBe(true); probeCalls++;
    queueMicrotask(finish);
    return { phaseId: "latency", packetsSent: 1, packetsReceived: 1, packetsLost: 0, latencyMs: { min: 5, avg: 5, max: 5, p95: 5, p99: 5 }, errors: [] };
  };
  const result = await runWithLoadedLatency(input, baseline, exec, probe, () => {});
  expect(result.loadedLatency).toMatchObject({ rttSamples: 1, deltaAvgMs: -5, deltaP95Ms: -5, baselineSamples: 10, packetLossPercent: 0 });
  expect(probeCalls).toBe(1);
});
it("does not invent a latency baseline or count probes completing after the load", async () => {
  const exec: IperfExecutor = async (_, onInterval) => {
    onInterval?.({ phaseKind: "tcp-upload", second: 1, throughputMbps: 50 });
    return { phaseId: "tcp-upload", throughputMbps: 50, errors: [] };
  };
  const probe: typeof runNetworkProbe = input => new Promise((resolve) => {
    input.signal!.addEventListener("abort", () => resolve({ phaseId: "latency", packetsSent: 1, packetsReceived: 1, packetsLost: 0, errors: [] }), { once: true });
  });
  const result = await runWithLoadedLatency(input, undefined, exec, probe, () => {});
  expect(result.loadedLatency).toMatchObject({ rttSamples: 0, packetsSent: 0 });
  expect(result.loadedLatency?.deltaAvgMs).toBeUndefined();
  expect(result.loadedLatency?.errors.join()).toContain("无有效 RTT");
});
it("preserves throughput when ICMP fails", async () => {
  let release!: () => void; const attempted = new Promise<void>(r => { release = r; });
  const exec: IperfExecutor = async (_, onInterval) => {
    onInterval?.({ phaseKind: "tcp-upload", second: 1, throughputMbps: 50 });
    await attempted;
    return { phaseId: "tcp-upload", throughputMbps: 50, errors: [] };
  };
  const result = await runWithLoadedLatency(input, baseline, exec, async () => {
    queueMicrotask(release); throw new Error("ping unavailable");
  }, () => {});
  expect(result.throughputMbps).toBe(50);
  expect(result.errors).toEqual([]);
  expect(result.loadedLatency?.errors).toContain("ping unavailable");
});

it("stops RTT capture at the data end event before process exit", async () => {
  const exec: IperfExecutor = async (input, interval) => {
    interval?.({ phaseKind: "tcp-upload", second: 1, throughputMbps: 10 });
    input.onDataEnd?.();
    await new Promise(resolve => setTimeout(resolve, 5));
    return { phaseId: "tcp-upload", throughputMbps: 10, errors: [] };
  };
  const result = await runWithLoadedLatency(input, baseline, exec, async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    return { phaseId: "latency", packetsSent: 1, packetsReceived: 1, packetsLost: 0, errors: [] };
  }, () => {});
  expect(result.loadedLatency?.packetsSent).toBe(0);
});
