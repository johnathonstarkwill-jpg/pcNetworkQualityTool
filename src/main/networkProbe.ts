import { execFile } from "node:child_process";
import net from "node:net";
import { CONTROL_PORT } from "./controlProtocol.js";
import type { PhaseMetrics, TestPhaseKind } from "../shared/types.js";

export interface ProbeInput {
  host: string;
  phaseKind: TestPhaseKind;
  durationSeconds: number;
  port?: number;
  signal?: AbortSignal;
}

// Nearest-rank percentiles, computed from successful echo replies only.
export function parsePingOutput(output: string, expectedCount: number): PhaseMetrics {
  const unix = output.match(/(\d+) packets transmitted,\s*(\d+)(?: packets)? received/);
  const windows = output.match(/(?:Sent|已发送)\s*=\s*(\d+).*?(?:Received|已接收)\s*=\s*(\d+)/s);
  const counts = unix ?? windows;
  if (!counts || Number(counts[1]) !== expectedCount) {
    return { phaseId: "latency", errors: ["无法解析 ping 统计；未生成 RTT 或丢包数据。"] };
  }
  const sent = Number(counts[1]);
  const received = Number(counts[2]);
  const replies = [...output.matchAll(/(?:time|时间)\s*([=<])\s*([\d.]+)\s*(?:ms|毫秒)/gi)];
  const samples = replies.map((m) => Number(m[2])).sort((a, b) => a - b);
  const upperBounds = replies.filter((m) => m[1] === "<").map((m) => Number(m[2]));
  const errors: string[] = [];
  if (!received) errors.push("未收到 ICMP Echo 响应（可能被防火墙禁用）；无 RTT 样本。");
  else if (samples.length !== received) errors.push("RTT 样本数与响应数不一致；未生成 RTT 统计。");
  return {
    phaseId: "latency", packetsSent: sent, packetsReceived: received,
    packetsLost: sent - received, packetLossPercent: (sent - received) / sent * 100,
    rttSamples: samples.length, errors,
    ...(upperBounds.length ? { rttUpperBoundMs: Math.max(...upperBounds), notes: ["ping 的 time<N 响应以 N ms 上界计入 RTT 统计。"] } : {}),
    ...(received > 0 && samples.length === received ? { latencyMs: {
      min: samples[0], avg: samples.reduce((a, b) => a + b, 0) / samples.length,
      max: samples[samples.length - 1], p95: samples[Math.ceil(samples.length * .95) - 1],
      p99: samples[Math.ceil(samples.length * .99) - 1]
    } } : {})
  };
}

export async function runNetworkProbe(input: ProbeInput): Promise<PhaseMetrics> {
  if (net.isIP(input.host) !== 4) throw new Error("探测目标必须为 IPv4 地址");
  input.signal?.throwIfAborted();
  if (input.phaseKind === "connectivity") {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: input.host, port: input.port ?? CONTROL_PORT });
      const finish = (error?: Error): void => {
        input.signal?.removeEventListener("abort", abort);
        socket.destroy();
        if (error) reject(error);
        else resolve({ phaseId: "connectivity", reachable: true, notes: ["TCP 控制端口连接成功；不代表 ICMP 或 UDP 可达。"], errors: [] });
      };
      const abort = (): void => finish(new Error("测试已取消"));
      input.signal?.addEventListener("abort", abort, { once: true });
      socket.setTimeout(Math.min(input.durationSeconds * 1000, 5000), () => finish(new Error("TCP 控制端口连接超时")));
      socket.once("connect", () => finish());
      socket.once("error", finish);
    });
  }
  const count = Math.max(1, Math.floor(input.durationSeconds));
  const args = process.platform === "win32"
    ? ["-n", String(count), "-w", "1000", input.host]
    : ["-n", "-c", String(count), "-i", "1", "-W", process.platform === "darwin" ? "1000" : "1", input.host];
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    execFile("ping", args, {
      windowsHide: true, encoding: "buffer", env: { ...process.env, LC_ALL: "C" },
      timeout: (count + 5) * 1000, signal: input.signal, maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => {
      if (input.signal?.aborted) { reject(new Error("测试已取消")); return; }
      const utf8 = stdout.toString("utf8");
      const output = process.platform === "win32" && utf8.includes("\uFFFD") ? new TextDecoder("gbk").decode(stdout) : utf8;
      const metrics = parsePingOutput(output, count);
      if (error && metrics.packetsSent === undefined) { reject(new Error(`ping 运行失败：${error.message}`)); return; }
      resolve({ ...metrics, durationSeconds: (performance.now() - startedAt) / 1000 });
    });
  });
}
