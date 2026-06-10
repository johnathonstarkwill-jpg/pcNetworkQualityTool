import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhaseMetrics, TestPhaseKind } from "../shared/types.js";

export interface BuildIperfArgsInput {
  host: string;
  phaseKind: TestPhaseKind;
  durationSeconds: number;
  targetBitrateMbps?: number;
}

export interface RunIperfInput extends BuildIperfArgsInput {
  binaryPath?: string;
}

export interface IntervalUpdate {
  phaseKind: TestPhaseKind;
  second: number;
  throughputMbps: number;
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
}

interface IperfIntervalData {
  sum?: IperfSum;
}

interface IperfEndData {
  sum_sent?: { bits_per_second?: number };
  sum_received?: { bits_per_second?: number };
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

  if (input.phaseKind === "tcp-download") {
    args.push("-R");
  }

  if (input.phaseKind === "udp-quality") {
    args.push("-u", "-b", `${input.targetBitrateMbps ?? 10}M`);
  }

  return args;
}

export async function runIperf(input: RunIperfInput, onInterval?: OnInterval): Promise<PhaseMetrics> {
  const binaryPath = input.binaryPath ?? resolveIperfBinary();
  const args = buildIperfArgs(input);

  let endData: IperfEndData | undefined;
  await runProcessStreaming(binaryPath, args, (line) => {
    let parsed: IperfStreamLine;
    try {
      parsed = JSON.parse(line) as IperfStreamLine;
    } catch {
      return;
    }

    if (parsed.event === "interval") {
      const update = intervalUpdate(input.phaseKind, parsed.data ?? {});
      if (update && onInterval) onInterval(update);
    } else if (parsed.event === "end") {
      endData = parsed.data;
    }
  });

  return extractEndMetrics(input.phaseKind, endData);
}

// Derive a per-interval update from one --json-stream "interval" event's data.
export function intervalUpdate(phaseKind: TestPhaseKind, data: IperfIntervalData): IntervalUpdate | null {
  const sum = data.sum;
  if (!sum || typeof sum.bits_per_second !== "number") return null;

  const update: IntervalUpdate = {
    phaseKind,
    second: Math.round(sum.end ?? 0),
    throughputMbps: toMbps(sum.bits_per_second)
  };
  if (typeof sum.lost_percent === "number") update.udpLossPercent = sum.lost_percent;
  if (typeof sum.jitter_ms === "number") update.jitterMs = sum.jitter_ms;
  return update;
}

// Produce the final PhaseMetrics from the --json-stream "end" event's data.
export function extractEndMetrics(phaseKind: TestPhaseKind, endData: IperfEndData | undefined): PhaseMetrics {
  const metrics: PhaseMetrics = { phaseId: phaseKind, errors: [] };

  if (!endData) {
    metrics.errors.push("Missing iperf3 end event.");
    return metrics;
  }

  if (phaseKind === "udp-quality") {
    const sum = endData.sum;
    if (!sum || typeof sum.bits_per_second !== "number") {
      metrics.errors.push("Missing UDP summary in iperf3 output.");
      return metrics;
    }
    metrics.throughputMbps = toMbps(sum.bits_per_second);
    metrics.udpLossPercent = sum.lost_percent;
    metrics.jitterMs = sum.jitter_ms;
    return metrics;
  }

  const tcpSummary = endData.sum_sent ?? endData.sum_received;
  if (!tcpSummary || typeof tcpSummary.bits_per_second !== "number") {
    metrics.errors.push("Missing TCP summary in iperf3 output.");
    return metrics;
  }
  metrics.throughputMbps = toMbps(tcpSummary.bits_per_second);
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
    input.phaseKind === "udp-quality" &&
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
function runProcessStreaming(command: string, args: string[], onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
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

    child.on("error", reject);

    child.on("close", (code) => {
      if (buffer.trim().length > 0) onLine(buffer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `iperf3 exited with code ${code}`));
    });
  });
}
