import { setTimeout as delay } from "node:timers/promises";
import { summarizeRtt } from "../shared/stability.js";
import type { LoadedLatency, PhaseMetrics } from "../shared/types.js";
import { runIperf, type RunIperfInput, type OnInterval } from "./iperfRunner.js";
import { runNetworkProbe } from "./networkProbe.js";

// Probe only after the first data interval, and discard probes still in flight
// when the load ends. A failed latency probe must not cancel throughput capture.
export async function runWithLoadedLatency(
  input: RunIperfInput, baseline: PhaseMetrics | undefined,
  iperfExec: typeof runIperf, probeExec: typeof runNetworkProbe, onInterval: OnInterval
): Promise<PhaseMetrics> {
  if (input.phaseKind !== "tcp-upload" && input.phaseKind !== "tcp-download") return iperfExec(input, onInterval);
  const stop = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, stop.signal]) : stop.signal;
  let monitoring: Promise<void> | undefined;
  const values: number[] = [];
  const loaded: LoadedLatency = { rttSamples: 0, packetsSent: 0, packetsReceived: 0, packetsLost: 0, notes: [], errors: [] };
  const monitor = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const sample = await probeExec({ host: input.host, phaseKind: "latency", durationSeconds: 1, signal });
        if (signal.aborted) break;
        if (sample.packetsSent === undefined || sample.packetsReceived === undefined) {
          loaded.errors.push(...(sample.errors.length ? sample.errors : ["负载 RTT 探测未返回发包统计"]));
          break;
        }
        loaded.packetsSent += sample.packetsSent;
        loaded.packetsReceived += sample.packetsReceived;
        loaded.packetsLost += sample.packetsLost ?? (sample.packetsSent - sample.packetsReceived);
        if (sample.latencyMs) values.push(sample.latencyMs.avg);
        loaded.notes.push(...(sample.notes ?? []));
        await delay(1000, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) loaded.errors.push(error instanceof Error ? error.message : "负载 RTT 探测失败");
        break;
      }
    }
  };
  let metrics: PhaseMetrics;
  try {
    metrics = await iperfExec({ ...input, onDataEnd: () => { stop.abort(); input.onDataEnd?.(); } }, update => {
      if (!monitoring && !signal.aborted) monitoring = monitor();
      onInterval(update);
    });
  } finally {
    stop.abort();
    await monitoring;
  }
  loaded.latencyMs = summarizeRtt(values);
  loaded.rttSamples = values.length;
  loaded.notes = [...new Set(loaded.notes)];
  if (loaded.packetsSent) loaded.packetLossPercent = loaded.packetsLost / loaded.packetsSent * 100;
  if (!values.length) loaded.errors.push("负载期间无有效 RTT 样本；未计算延迟增量。");
  if (baseline?.latencyMs && loaded.latencyMs) {
    loaded.deltaAvgMs = loaded.latencyMs.avg - baseline.latencyMs.avg;
    loaded.deltaP95Ms = loaded.latencyMs.p95 - baseline.latencyMs.p95;
    loaded.baselineSamples = baseline.rttSamples;
  } else loaded.notes.push("空载或负载 RTT 缺失，延迟增量不可用。");
  return { ...metrics!, loadedLatency: loaded };
}
