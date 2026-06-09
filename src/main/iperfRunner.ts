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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildIperfArgs(input: BuildIperfArgsInput): string[] {
  validateIperfInput(input);

  const args = ["-c", input.host, "-J", "-t", String(input.durationSeconds)];

  if (input.phaseKind === "tcp-download") {
    args.push("-R");
  }

  if (input.phaseKind === "udp-quality") {
    args.push("-u", "-b", `${input.targetBitrateMbps ?? 10}M`);
  }

  return args;
}

export async function runIperf(input: RunIperfInput): Promise<PhaseMetrics> {
  const binaryPath = input.binaryPath ?? resolveIperfBinary();
  const args = buildIperfArgs(input);
  const stdout = await runProcess(binaryPath, args);

  return parseIperfJson(input.phaseKind, stdout);
}

export function parseIperfJson(phaseKind: TestPhaseKind, rawJson: string): PhaseMetrics {
  const metrics: PhaseMetrics = {
    phaseId: phaseKind,
    errors: []
  };

  let parsed: IperfJson;
  try {
    parsed = JSON.parse(rawJson) as IperfJson;
  } catch (error) {
    metrics.errors.push(`Invalid iperf3 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return metrics;
  }

  if (phaseKind === "udp-quality") {
    const sum = parsed.end?.sum;
    if (!sum || typeof sum.bits_per_second !== "number") {
      metrics.errors.push("Missing UDP summary in iperf3 output.");
      return metrics;
    }

    metrics.throughputMbps = toMbps(sum.bits_per_second);
    metrics.udpLossPercent = sum.lost_percent;
    metrics.jitterMs = sum.jitter_ms;
    return metrics;
  }

  const tcpSummary = parsed.end?.sum_sent ?? parsed.end?.sum_received;
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

  // In a packaged Electron app, extraResources land in process.resourcesPath.
  // electron-builder maps assets/iperf3 -> <resources>/iperf3.
  const isPackaged = Boolean(process.resourcesPath) && __dirname.includes("app.asar");
  const baseDir = isPackaged
    ? path.join(process.resourcesPath as string, "iperf3")
    : path.join(__dirname, "../../assets/iperf3");

  return path.join(baseDir, platformDir, binaryName);
}

interface IperfJson {
  end?: {
    sum_sent?: { bits_per_second?: number };
    sum_received?: { bits_per_second?: number };
    sum?: { bits_per_second?: number; lost_percent?: number; jitter_ms?: number };
  };
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

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr || `iperf3 exited with code ${code}`));
    });
  });
}
