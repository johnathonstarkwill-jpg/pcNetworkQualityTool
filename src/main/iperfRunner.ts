import { summarizeStability } from "../shared/stability.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhaseMetrics, TestPhaseKind, ThroughputSample } from "../shared/types.js";

export interface BuildIperfArgsInput {
  host: string;
  phaseKind: TestPhaseKind;
  durationSeconds: number;
  targetBitrateMbps?: number;
}

export interface RunIperfInput extends BuildIperfArgsInput {
  binaryPath?: string;
  signal?: AbortSignal;
  onDataEnd?: () => void;
}

export interface IntervalUpdate {
  phaseKind: TestPhaseKind;
  second: number;
  throughputMbps: number;
  startSeconds?: number;
  endSeconds?: number;
  side?: "sender" | "receiver";
  udpLossPercent?: number;
  jitterMs?: number;
}

export type OnInterval = (update: IntervalUpdate) => void;

interface IperfSum {
  start?: number;
  end?: number;
  bits_per_second?: number;
  lost_percent?: number;
  jitter_ms?: number;
  bytes?: number;
  seconds?: number;
  retransmits?: number;
  packets?: number;
  lost_packets?: number;
  sender?: boolean;
}

interface IperfIntervalData {
  sum?: IperfSum;
}

interface IperfEndData {
  sum_sent?: IperfSum;
  sum_received?: IperfSum;
  sum?: IperfSum;
}

interface IperfStreamLine {
  event?: string;
  data?: IperfIntervalData & IperfEndData;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildIperfArgs(input: BuildIperfArgsInput): string[] {
  validateIperfInput(input);

  const args = ["-c", input.host, "--json-stream", "-t", String(input.durationSeconds)];

  if (input.phaseKind === "tcp-download" || input.phaseKind === "udp-download") {
    args.push("-R");
  }

  if ((input.phaseKind === "udp-quality" || input.phaseKind === "udp-download")) {
    args.push("-u", "-b", `${input.targetBitrateMbps ?? 10}M`);
  }

  return args;
}

export async function runIperf(input: RunIperfInput, onInterval?: OnInterval): Promise<PhaseMetrics> {
  const binaryPath = input.binaryPath ?? resolveIperfBinary();
  const args = buildIperfArgs(input);

  let endData: IperfEndData | undefined;
  const intervals: ThroughputSample[] = [];
  let processError: string | undefined;
  try {
  await runProcessStreaming(binaryPath, args, (line) => {
    let parsed: IperfStreamLine;
    try {
      parsed = JSON.parse(line) as IperfStreamLine;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    if (parsed.event === "interval") {
      const update = intervalUpdate(input.phaseKind, parsed.data ?? {});
      if (update) {
        intervals.push({ startSeconds: update.startSeconds!, endSeconds: update.endSeconds!, mbps: update.throughputMbps, side: update.side! });
        onInterval?.(update);
      }
    } else if (parsed.event === "end") {
      endData = parsed.data;
      input.onDataEnd?.();
    }
  }, (input.durationSeconds + 15) * 1000, input.signal);

  } catch (error) {
    if (input.signal?.aborted) throw error;
    processError = error instanceof Error ? error.message : "iperf3 运行失败";
  }
  const metrics = extractEndMetrics(input.phaseKind, endData);
  return { ...metrics, errors: processError ? [processError] : metrics.errors, targetBitrateMbps: input.targetBitrateMbps,
    intervals, throughputSeriesSide: intervals[0]?.side, stability: summarizeStability(intervals, metrics.durationSeconds) };
}

// Derive a per-interval update from one --json-stream "interval" event's data.
export function intervalUpdate(phaseKind: TestPhaseKind, data: IperfIntervalData): IntervalUpdate | null {
  const sum = data.sum;
  if (!sum || typeof sum.bits_per_second !== "number" || !Number.isFinite(sum.bits_per_second) || sum.bits_per_second < 0
    || typeof sum.start !== "number" || typeof sum.end !== "number" || sum.end <= sum.start) return null;

  return {
    phaseKind,
    second: Math.round(sum.end),
    startSeconds: sum.start, endSeconds: sum.end,
    side: sum.sender === false || phaseKind === "tcp-download" || phaseKind === "udp-download" ? "receiver" : "sender",
    throughputMbps: toMbps(sum.bits_per_second),
    ...(sum.sender === false && typeof sum.lost_percent === "number" ? { udpLossPercent: sum.lost_percent } : {}),
    ...(sum.sender === false && typeof sum.jitter_ms === "number" ? { jitterMs: sum.jitter_ms } : {})
  };
}

// Produce the final PhaseMetrics from the --json-stream "end" event's data.
export function extractEndMetrics(phaseKind: TestPhaseKind, endData: IperfEndData | undefined): PhaseMetrics {
  if (!endData) {
    return { phaseId: phaseKind, errors: ["Missing iperf3 end event."] };
  }

  const receiver = endData.sum_received ?? ((phaseKind === "udp-quality" || phaseKind === "udp-download") && endData.sum?.sender !== true ? endData.sum : undefined);
  const sender = endData.sum_sent;
  if (!receiver || typeof receiver.bits_per_second !== "number" || !Number.isFinite(receiver.bits_per_second)) {
    return { phaseId: phaseKind, errors: ["Missing receiver summary in iperf3 output."] };
  }
  const metrics: PhaseMetrics = {
    phaseId: phaseKind, errors: [], throughputMbps: toMbps(receiver.bits_per_second),
    senderMbps: typeof sender?.bits_per_second === "number" ? toMbps(sender.bits_per_second) : undefined,
    bytesReceived: receiver.bytes, durationSeconds: receiver.seconds,
    ...((phaseKind !== "udp-quality" && phaseKind !== "udp-download") ? { retransmits: sender?.retransmits } : {})
  };
  if ((phaseKind === "udp-quality" || phaseKind === "udp-download")) {
    metrics.udpLossPercent = receiver.lost_percent;
    metrics.jitterMs = receiver.jitter_ms;
    metrics.packetsSent = receiver.packets;
    metrics.packetsLost = receiver.lost_packets;
    if (receiver.packets !== undefined && receiver.lost_packets !== undefined) {
      metrics.packetsReceived = receiver.packets - receiver.lost_packets;
    }
    if (receiver.lost_percent === undefined || receiver.jitter_ms === undefined) {
      metrics.errors.push("UDP 接收端未提供丢包率或抖动数据。");
    }
  }
  return metrics;
}

export function resolveIperfBinary(): string {
  const platformDir = `${process.platform}-${process.arch}`;
  const binaryName = process.platform === "win32" ? "iperf3.exe" : "iperf3";

  const isPackaged = Boolean(process.resourcesPath) && __dirname.includes("app.asar");
  const baseDir = isPackaged
    ? path.join(process.resourcesPath as string, "iperf3")
    : path.join(__dirname, "../../assets/iperf3");

  return path.join(baseDir, platformDir, binaryName);
}

function validateIperfInput(input: BuildIperfArgsInput): void {
  if (input.host.trim().length === 0) {
    throw new Error("Invalid host: host is required.");
  }
  if (!isPositiveFinite(input.durationSeconds)) {
    throw new Error("Invalid duration: durationSeconds must be a positive finite number.");
  }
  if (
    (input.phaseKind === "udp-quality" || input.phaseKind === "udp-download") &&
    input.targetBitrateMbps !== undefined &&
    !isPositiveFinite(input.targetBitrateMbps)
  ) {
    throw new Error("Invalid bitrate: targetBitrateMbps must be a positive finite number.");
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function toMbps(bitsPerSecond: number): number {
  return bitsPerSecond / 1_000_000;
}

// Spawn a process and invoke onLine for each complete stdout line as it arrives.
function runProcessStreaming(command: string, args: string[], onLine: (line: string) => void, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal });
    const timer = setTimeout(() => { child.kill(); reject(new Error("iperf3 测试超时")); }, timeoutMs);
    let buffer = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim().length > 0) onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => { clearTimeout(timer); reject(error); });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer.trim().length > 0) onLine(buffer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `iperf3 exited with code ${code}`));
    });
  });
}
