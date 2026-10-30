import type { PhaseMetrics, TestPhase } from "./types.js";

export const PHASE_LABELS: Record<string, string> = {
  connectivity: "TCP 控制端口连通性", latency: "ICMP Echo（空载）",
  "tcp-upload": "TCP 上行（客户端 → 服务器）", "tcp-download": "TCP 下行（服务器 → 客户端）",
  "udp-quality": "UDP 上行（客户端 → 服务器）",
  "udp-download": "UDP 下行（服务器 → 客户端）"
};

// A completion message alone is not evidence that any metric was measured.
export function finalizePhase(phase: TestPhase, measured?: PhaseMetrics): PhaseMetrics {
  if (!measured) return { phaseId: phase.id, targetBitrateMbps: phase.targetBitrateMbps, errors: ["阶段未完成（断开、超时或未提交结果）"] };
  const metrics = { ...measured, phaseId: phase.id, targetBitrateMbps: phase.targetBitrateMbps, errors: [...measured.errors] };
  const required: Array<keyof PhaseMetrics> = phase.kind === "connectivity" ? ["reachable"]
    : phase.kind === "latency" ? ["packetsSent", "packetsReceived", "packetLossPercent", "latencyMs"]
    : (phase.kind === "udp-quality" || phase.kind === "udp-download") ? ["throughputMbps", "udpLossPercent", "jitterMs", "packetsSent", "packetsLost"]
    : ["throughputMbps"];
  const missing = required.filter(key => metrics[key] === undefined);
  if (missing.length && !metrics.errors.length) metrics.errors.push(`未采集必要指标：${missing.join("、")}`);
  if (phase.kind === "connectivity" && metrics.reachable === false && !metrics.errors.length) metrics.errors.push("TCP 控制端口不可达");
  return metrics;
}
