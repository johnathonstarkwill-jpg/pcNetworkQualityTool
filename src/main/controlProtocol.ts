import net from "node:net";
import type { ControlMessage, PhaseMetrics, TestPlan, ThroughputSample } from "../shared/types.js";

export const CONTROL_PORT = 48200;
const MAX_FRAME_LENGTH = 65_536;
export const PHASE_KINDS = ["connectivity", "latency", "tcp-upload", "tcp-download", "udp-quality", "udp-download"];
const SUITES = ["quick-check", "standard-acceptance", "video-meeting", "hd-video", "long-stability"];

export function encode(message: ControlMessage): string {
  return `${JSON.stringify(message)}\n`;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096;
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function isValidInterval(v: unknown): v is ThroughputSample {
  return object(v) && number(v.startSeconds) && number(v.endSeconds) && v.endSeconds > v.startSeconds
    && v.endSeconds <= 86430 && number(v.mbps) && (v.side === "sender" || v.side === "receiver");
}
function validRtt(v: unknown): boolean {
  return object(v) && ["min", "avg", "max", "p95", "p99"].every(k => number(v[k]));
}
export function isValidMetrics(v: unknown): v is PhaseMetrics {
  if (!object(v) || !text(v.phaseId) || !Array.isArray(v.errors) || !v.errors.every(text)) return false;
  if (v.notes !== undefined && (!Array.isArray(v.notes) || !v.notes.every(text))) return false;
  if (v.reachable !== undefined && typeof v.reachable !== "boolean") return false;
  for (const key of ["throughputMbps", "senderMbps", "bytesReceived", "retransmits", "durationSeconds", "targetBitrateMbps", "packetsSent", "packetsReceived", "packetsLost", "packetLossPercent", "rttSamples", "rttUpperBoundMs", "udpLossPercent", "jitterMs"]) {
    if (v[key] !== undefined && !number(v[key])) return false;
  }
  for (const key of ["packetLossPercent", "udpLossPercent"]) if (number(v[key]) && v[key] > 100) return false;
  if (v.latencyMs !== undefined && !validRtt(v.latencyMs)) return false;
  if (v.intervals !== undefined && (!Array.isArray(v.intervals) || v.intervals.length > 86400 || !v.intervals.every(isValidInterval))) return false;
  if (v.throughputSeriesSide !== undefined && !["sender", "receiver"].includes(String(v.throughputSeriesSide))) return false;
  if (v.stability !== undefined) {
    if (!object(v.stability) || !["sampleCount", "observedSeconds", "minMbps", "avgMbps", "maxMbps", "stddevMbps", "zeroSeconds", "longestZeroSeconds", "zeroEvents", "missingSeconds"].every(k => number((v.stability as Record<string, unknown>)[k]))) return false;
    if (v.stability.cvPercent !== undefined && !number(v.stability.cvPercent)) return false;
  }
  if (v.loadedLatency !== undefined) {
    const l = v.loadedLatency;
    if (!object(l) || !["rttSamples", "packetsSent", "packetsReceived", "packetsLost"].every(k => number(l[k]))
      || !Array.isArray(l.errors) || !l.errors.every(text) || !Array.isArray(l.notes) || !l.notes.every(text)) return false;
    if (l.latencyMs !== undefined && !validRtt(l.latencyMs)) return false;
    for (const key of ["deltaAvgMs", "deltaP95Ms"]) if (l[key] !== undefined && (typeof l[key] !== "number" || !Number.isFinite(l[key]))) return false;
    if (l.packetLossPercent !== undefined && (!number(l.packetLossPercent) || l.packetLossPercent > 100)) return false;
    if (l.baselineSamples !== undefined && !number(l.baselineSamples)) return false;
  }
  return true;
}
function validPlan(v: unknown): v is TestPlan {
  return object(v) && typeof v.suiteId === "string" && SUITES.includes(v.suiteId) && text(v.label)
    && ["single", "separate", "concurrent"].includes(String(v.runMode))
    && Array.isArray(v.phases) && v.phases.length > 0 && v.phases.length <= 20
    && v.phases.every(p => object(p) && text(p.id) && text(p.label) && PHASE_KINDS.includes(String(p.kind))
      && number(p.durationSeconds) && p.durationSeconds >= 1 && p.durationSeconds <= 86400
      && (p.targetBitrateMbps === undefined || (number(p.targetBitrateMbps) && p.targetBitrateMbps > 0)))
    && new Set(v.phases.map(p => p.id)).size === v.phases.length;
}
function validMessage(v: unknown): v is ControlMessage {
  if (!object(v)) return false;
  switch (v.type) {
    case "register-client": return object(v.client) && text(v.client.id) && text(v.client.name) && text(v.client.address);
    case "client-registered": return text(v.clientId);
    case "start-test": return text(v.runId) && validPlan(v.plan) && typeof v.serverAddress === "string" && net.isIP(v.serverAddress.replace(/^::ffff:/, "")) === 4;
    case "phase-progress": return text(v.runId) && text(v.clientId) && text(v.phaseId) && isValidInterval(v.interval);
    case "phase-result": return text(v.runId) && text(v.clientId) && isValidMetrics(v.metrics);
    case "test-busy":
    case "test-complete": return text(v.runId) && text(v.clientId);
    case "cancel-test": return text(v.runId);
    case "log": return text(v.clientId) && text(v.line);
    case "suite-complete": return SUITES.includes(String(v.suiteId)) && ["completed", "incomplete"].includes(String(v.status));
    case "error": return text(v.message);
    default: return false;
  }
}

// Bound partial frames as well as complete frames. Discard through the next
// newline after overflow, so a suffix cannot become a fresh message.
export function createDecoder(): (chunk: string) => ControlMessage[] {
  let buffer = "";
  let discarding = false;
  return (chunk) => {
    const messages: ControlMessage[] = [];
    for (const part of chunk.split(/(?<=\n)/)) {
      const complete = part.endsWith("\n");
      if (!discarding && buffer.length + part.length <= MAX_FRAME_LENGTH) buffer += part;
      else { buffer = ""; discarding = true; }
      if (!complete) continue;
      if (!discarding && buffer.trim()) {
        try {
          const parsed: unknown = JSON.parse(buffer);
          if (validMessage(parsed)) messages.push(parsed);
        } catch { /* Ignore invalid frames. */ }
      }
      buffer = "";
      discarding = false;
    }
    return messages;
  };
}
