# Live Progress Log + Suite Coloring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream per-second iperf data + progress events into a console-like log panel on both the server and client screens, and color test suites by report rating (server suite buttons + a client current-suite status bar).

**Architecture:** iperf3 runs with `--json-stream` (NDJSON, one object per interval). `runIperf` gains an `onInterval` callback. Control server/client each keep a capped log buffer pushed to the renderer via existing state push; clients relay log lines to the server. A new `suite-complete` control message broadcasts the rating so clients color their status bar.

**Tech Stack:** Electron, TypeScript, Node `child_process`, React, Vitest.

---

## Source Spec

`docs/superpowers/specs/2026-06-10-live-progress-and-suite-coloring-design.md`

## File Structure

```text
src/main/logBuffer.ts          [create] MAX_LOG_LINES, appendLog, stamp
src/shared/types.ts            [modify] ControlMessage +log/+suite-complete; states +log/+suiteRatings/+currentSuite
src/main/iperfRunner.ts        [modify] --json-stream + onInterval + streaming parse
src/main/controlClient.ts      [modify] log buffer, pushLog, onInterval wiring, currentSuite
src/main/controlServer.ts      [modify] log buffer, pushLog, relay log, suiteRatings, broadcast suite-complete
src/renderer/App.tsx           [modify] LogConsole + suite coloring
src/renderer/styles.css        [modify] .log-console + suite color classes
tests/unit/logBuffer.test.ts   [create]
tests/unit/iperfParser.test.ts [modify] new stream parsing
tests/unit/controlChannel.test.ts [modify] log relay + suite-complete
```

---

## Task 1: logBuffer module

**Files:**
- Create: `src/main/logBuffer.ts`
- Test: `tests/unit/logBuffer.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/logBuffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_LOG_LINES, appendLog, stamp } from "../../src/main/logBuffer";

describe("logBuffer", () => {
  it("appends a line returning a new array without mutating input", () => {
    const input = ["a"];
    const out = appendLog(input, "b");
    expect(out).toEqual(["a", "b"]);
    expect(input).toEqual(["a"]);
  });

  it("caps the buffer at MAX_LOG_LINES dropping the oldest", () => {
    const full = Array.from({ length: MAX_LOG_LINES }, (_, i) => `line-${i}`);
    const out = appendLog(full, "newest");
    expect(out.length).toBe(MAX_LOG_LINES);
    expect(out[0]).toBe("line-1");
    expect(out[out.length - 1]).toBe("newest");
  });

  it("prefixes a line with an HH:MM:SS timestamp", () => {
    const fixed = new Date(2026, 5, 10, 9, 8, 7);
    expect(stamp("hello", fixed)).toBe("[09:08:07] hello");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/logBuffer.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Write `src/main/logBuffer.ts`:

```ts
export const MAX_LOG_LINES = 500;

// Prefix a log line with a zero-padded HH:MM:SS timestamp.
export function stamp(line: string, now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}] ${line}`;
}

// Append a line, returning a new array capped at MAX_LOG_LINES (oldest dropped).
export function appendLog(buffer: readonly string[], line: string): string[] {
  const next = [...buffer, line];
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}
```

- [ ] **Step 4: Run — expect PASS (3)**

Run: `npm test -- tests/unit/logBuffer.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/main/logBuffer.ts tests/unit/logBuffer.test.ts
git commit -m "feat: add capped log buffer with timestamps"
```

---

## Task 2: Shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Extend ControlMessage and session states**

In `src/shared/types.ts`:

(a) Replace the `ControlMessage` union with (adds two variants):

```ts
export type ControlMessage =
  | { type: "register-client"; client: ConnectedClient }
  | { type: "client-registered"; clientId: string }
  | { type: "start-test"; plan: TestPlan; serverAddress: string }
  | { type: "phase-result"; clientId: string; metrics: PhaseMetrics }
  | { type: "test-complete"; clientId: string }
  | { type: "log"; clientId: string; line: string }
  | { type: "suite-complete"; suiteId: TestSuiteId; rating: ReportSummary["rating"] }
  | { type: "error"; message: string };
```

(b) Replace `ServerSessionState` with:

```ts
export interface ServerSessionState {
  role: "server";
  clients: ConnectedClient[];
  activePlan?: TestPlan;
  latestReport?: TestReport;
  listening: boolean;
  localAddresses: string[];
  testingClientId?: string;
  log: string[];
  suiteRatings: Partial<Record<TestSuiteId, ReportSummary["rating"]>>;
}
```

(c) Replace `ClientSessionState` with:

```ts
export interface ClientSessionState {
  role: "client";
  discoveredServers: DiscoveredServer[];
  connectedServer?: DiscoveredServer;
  status: "searching" | "connecting" | "connected" | "testing" | "error";
  statusText: string;
  lastResult?: PhaseMetrics[];
  log: string[];
  currentSuite?: { label: string; status: "running" | ReportSummary["rating"] };
}
```

- [ ] **Step 2: Typecheck (expected to fail until Tasks 4–5 set the new required fields)**

Run: `npm run build`
Expected: FAIL — `controlServer.getState()` / `controlClient.getState()` do not yet return the new REQUIRED fields (`log`, `suiteRatings`, client `log`). This is expected; fixed in Tasks 4 and 5. Do not commit standalone.

- [ ] **Step 3: Commit happens with Task 5**

(Committed once getState compiles. Proceed to Task 3.)

---

## Task 3: iperf3 --json-stream + onInterval

**Files:**
- Modify: `src/main/iperfRunner.ts`
- Test: `tests/unit/iperfParser.test.ts`

- [ ] **Step 1: Rewrite the iperfParser tests for stream parsing**

Replace the ENTIRE contents of `tests/unit/iperfParser.test.ts` with:

```ts
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
    expect(u).toEqual({ phaseKind: "tcp-upload", second: 2, throughputMbps: 100 });
  });

  it("includes loss and jitter for udp interval data", () => {
    const u = intervalUpdate("udp-quality", {
      sum: { start: 4, end: 5, bits_per_second: 8_000_000, lost_percent: 1.5, jitter_ms: 0.3 }
    });
    expect(u).toEqual({ phaseKind: "udp-quality", second: 5, throughputMbps: 8, udpLossPercent: 1.5, jitterMs: 0.3 });
  });

  it("returns null when interval data lacks a numeric throughput", () => {
    expect(intervalUpdate("tcp-upload", { sum: { start: 0, end: 1 } })).toBeNull();
  });
});

describe("extractEndMetrics", () => {
  it("reads tcp throughput from the end event data", () => {
    const m = extractEndMetrics("tcp-upload", { sum_sent: { bits_per_second: 943_000_000 } });
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
    expect(m.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/iperfParser.test.ts`
Expected: FAIL — `extractEndMetrics`/`intervalUpdate` not exported; args still use `-J`.

- [ ] **Step 3: Rewrite iperfRunner.ts**

Replace the ENTIRE contents of `src/main/iperfRunner.ts` with:

```ts
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
      return; // skip malformed NDJSON line
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
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- tests/unit/iperfParser.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/iperfRunner.ts tests/unit/iperfParser.test.ts
git commit -m "feat: stream iperf3 intervals via --json-stream"
```

---

## Task 4: ControlClient — logs + currentSuite

**Files:**
- Modify: `src/main/controlClient.ts`
- Test: `tests/unit/controlChannel.test.ts`

- [ ] **Step 1: Add a failing test for client logging + currentSuite**

Append to `tests/unit/controlChannel.test.ts`:

```ts
describe("ControlClient logging and currentSuite", () => {
  it("logs intervals + phases and sets currentSuite from start-test", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const fakeExec = async (input: { phaseKind: string }, onInterval?: (u: unknown) => void) => {
      onInterval?.({ phaseKind: input.phaseKind, second: 1, throughputMbps: 50 });
      return { phaseId: input.phaseKind, throughputMbps: 50, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const client = new ControlClient({ iperfExec: fakeExec as never, id: "lg", name: "LG" });
    await new Promise<void>((resolve) => {
      client.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(); });
      client.connectToAddress("127.0.0.1", port);
    });

    const done = new Promise<void>((resolve) => srv.on("test-complete", () => resolve()));
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["lg"]);
    await done;

    const state = client.getState();
    expect(state.currentSuite?.label).toBe("快速检测");
    expect(state.log.some((l) => l.includes("快速检测"))).toBe(true);
    expect(state.log.some((l) => l.includes("Mbps"))).toBe(true);

    client.disconnect();
    await srv.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: FAIL — `currentSuite`/`log` not populated.

- [ ] **Step 3: Edit controlClient.ts**

In `src/main/controlClient.ts`:

(a) Update imports — add logBuffer + types:

```ts
import { appendLog, stamp } from "./logBuffer.js";
```
and extend the type import to include `ReportSummary` and `TestPhaseKind` (TestPhaseKind already imported):
```ts
import type {
  ClientSessionState,
  ConnectedClient,
  DiscoveredServer,
  PhaseMetrics,
  ReportSummary,
  TestPhaseKind,
  TestPlan
} from "../shared/types.js";
```

(b) Add a phase-label map near `RUNNABLE_PHASES`:

```ts
const PHASE_LABELS: Record<TestPhaseKind, string> = {
  connectivity: "连通性",
  latency: "延迟",
  "tcp-upload": "TCP 上行",
  "tcp-download": "TCP 下行",
  "udp-quality": "UDP"
};
```

(c) Add fields (next to `lastResult`):

```ts
  private log: string[] = [];
  private currentSuite: ClientSessionState["currentSuite"];
```

(d) Update `getState()` to include them:

```ts
  getState(): ClientSessionState {
    return {
      role: "client",
      discoveredServers: [...this.discoveredServers.values()],
      connectedServer: this.connectedServer,
      status: this.status,
      statusText: this.statusText,
      lastResult: this.lastResult,
      log: this.log,
      currentSuite: this.currentSuite
    };
  }
```

(e) Add a `pushLog` helper (place above `getState` or near `fail`):

```ts
  private pushLog(line: string): void {
    this.log = appendLog(this.log, stamp(line));
    if (this.socket && !this.intentionalClose) {
      this.socket.write(encode({ type: "log", clientId: this.identity.id, line }));
    }
    this.emit("state", this.getState());
  }
```

(f) In the socket `data` handler, handle `suite-complete` and set `currentSuite` on `start-test`. Replace the existing `data` handler block:

```ts
    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "client-registered") {
          this.status = "connected";
          this.statusText = "已连接，等待服务器开始测试";
          this.emit("state", this.getState());
        } else if (message.type === "start-test") {
          this.currentSuite = { label: message.plan.label, status: "running" };
          this.pushLog(`收到测试计划：${message.plan.label}`);
          void this.runPlan(message.plan, message.serverAddress);
        } else if (message.type === "suite-complete") {
          this.currentSuite = { label: this.currentSuite?.label ?? "", status: message.rating };
          this.pushLog(`套件完成，评级：${message.rating}`);
        }
      }
    });
```

(g) Add an interval formatter (near `PHASE_LABELS`):

```ts
function formatInterval(update: {
  phaseKind: TestPhaseKind;
  second: number;
  throughputMbps: number;
  udpLossPercent?: number;
  jitterMs?: number;
}): string {
  const base = `${PHASE_LABELS[update.phaseKind]} ${update.second}s: ${update.throughputMbps.toFixed(1)} Mbps`;
  if (update.udpLossPercent !== undefined || update.jitterMs !== undefined) {
    return `${base} 丢包 ${(update.udpLossPercent ?? 0).toFixed(1)}% 抖动 ${(update.jitterMs ?? 0).toFixed(2)}ms`;
  }
  return base;
}
```

(h) Wire `onInterval` + phase logging into `runManualTest`:

```ts
  async runManualTest(): Promise<void> {
    if (this.status === "testing") return;
    const host = this.connectedServer?.address;
    if (!host) {
      this.fail("尚未连接服务器，无法测试");
      return;
    }

    this.status = "testing";
    this.statusText = "正在测试网络质量";
    this.pushLog("开始手动测试");

    try {
      const onInterval = (u: Parameters<NonNullable<Parameters<typeof this.iperfExec>[1]>>[0]): void => {
        this.pushLog(formatInterval(u));
      };
      const tcp = await this.iperfExec({ host, phaseKind: "tcp-upload", durationSeconds: 5 }, onInterval);
      const udp = await this.iperfExec({ host, phaseKind: "udp-quality", durationSeconds: 5, targetBitrateMbps: 10 }, onInterval);
      this.lastResult = [tcp, udp];
      this.status = "connected";
      this.statusText = "测试完成";
      this.pushLog("手动测试完成");
    } catch (error: unknown) {
      this.status = "error";
      this.statusText = error instanceof Error ? `测试失败：${error.message}` : "测试失败";
      this.pushLog(this.statusText);
    }
    this.emit("state", this.getState());
  }
```

(i) Wire logging into `runPlan`:

```ts
  private async runPlan(plan: TestPlan, serverAddress: string): Promise<void> {
    if (this.status === "testing") return;
    const socket = this.socket;
    if (!socket) return;

    this.status = "testing";
    this.statusText = "正在准备测试";
    this.emit("state", this.getState());

    const phases = plan.phases.filter((phase) => RUNNABLE_PHASES.has(phase.kind));
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      this.statusText = `正在测试 ${phase.label} (${index + 1}/${phases.length})`;
      this.pushLog(`开始 ${phase.label}`);

      let metrics: PhaseMetrics;
      try {
        metrics = await this.iperfExec(
          {
            host: serverAddress,
            phaseKind: phase.kind,
            durationSeconds: phase.durationSeconds,
            targetBitrateMbps: phase.targetBitrateMbps
          },
          (u) => this.pushLog(formatInterval(u))
        );
        const mbps = metrics.throughputMbps !== undefined ? `${metrics.throughputMbps.toFixed(1)} Mbps` : "—";
        this.pushLog(`完成 ${phase.label}: ${mbps}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "测试阶段失败";
        metrics = { phaseId: phase.id, errors: [message] };
        this.pushLog(`${phase.label} 阶段失败：${message}`);
      }
      socket.write(encode({ type: "phase-result", clientId: this.identity.id, metrics }));
    }

    socket.write(encode({ type: "test-complete", clientId: this.identity.id }));
    this.status = "connected";
    this.statusText = "测试完成";
    this.emit("state", this.getState());
  }
```

Note: `ReportSummary` is imported for the `currentSuite` type via `ClientSessionState`; the explicit import keeps it available if needed. If TypeScript flags `ReportSummary` as unused, remove it from the import — keep `TestPhaseKind`.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: the new client-logging test PASSES; existing control-channel tests still pass.

Run: `npm run build`
Expected: still FAILS only on `controlServer.getState()` missing `log`/`suiteRatings` (Task 5). If it compiles, even better.

- [ ] **Step 5: Commit (with Task 5 if build not yet green)**

If `npm run build` is green, commit now:
```bash
git add src/main/controlClient.ts tests/unit/controlChannel.test.ts
git commit -m "feat: client streams progress log and tracks current suite"
```
Otherwise commit together at Task 5 Step 5.

---

## Task 5: ControlServer — logs + suiteRatings + broadcast

**Files:**
- Modify: `src/main/controlServer.ts`
- Test: `tests/unit/controlChannel.test.ts`

- [ ] **Step 1: Add a failing test for server log relay + suiteRatings + suite-complete**

Append to `tests/unit/controlChannel.test.ts`:

```ts
describe("ControlServer logging and suite coloring", () => {
  it("relays client logs, records the suite rating, and broadcasts suite-complete", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const fakeExec = async (input: { phaseKind: string }, onInterval?: (u: unknown) => void) => {
      onInterval?.({ phaseKind: input.phaseKind, second: 1, throughputMbps: 50 });
      return { phaseId: input.phaseKind, throughputMbps: 50, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const client = new ControlClient({ iperfExec: fakeExec as never, id: "cl", name: "Box" });
    await new Promise<void>((resolve) => {
      client.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(); });
      client.connectToAddress("127.0.0.1", port);
    });

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => { if (s.latestReport) resolve(s); });
    });
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["cl"]);
    const finalState = await reported;

    expect(finalState.log.some((l) => l.includes("Box"))).toBe(true);
    expect(finalState.suiteRatings["quick-check"]).toBeDefined();
    expect(finalState.suiteRatings["quick-check"]).toBe(finalState.latestReport?.summary.rating);

    // The client received suite-complete and colored its status bar.
    await new Promise((r) => setTimeout(r, 100));
    expect(client.getState().currentSuite?.status).toBe(finalState.latestReport?.summary.rating);

    client.disconnect();
    await srv.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: FAIL — server has no `log`/`suiteRatings`, doesn't relay or broadcast.

- [ ] **Step 3: Edit controlServer.ts**

In `src/main/controlServer.ts`:

(a) Add imports:

```ts
import { appendLog, stamp } from "./logBuffer.js";
```
Extend the shared-types import to include `ReportSummary` and `TestSuiteId`:
```ts
import type {
  ClientTestResult,
  ConnectedClient,
  ControlMessage,
  PhaseMetrics,
  ReportSummary,
  ServerSessionState,
  TestPlan,
  TestReport,
  TestSuiteId
} from "../shared/types.js";
```

(b) Add fields (next to `results`):

```ts
  private logLines: string[] = [];
  private suiteRatings: Partial<Record<TestSuiteId, ReportSummary["rating"]>> = {};
```

(c) Update `getState()`:

```ts
  getState(): ServerSessionState {
    return {
      role: "server",
      clients: [...this.clients.values()],
      activePlan: this.activePlan,
      latestReport: this.latestReport,
      listening: this.listening,
      localAddresses: this.localAddresses,
      testingClientId: this.testingClientId,
      log: this.logLines,
      suiteRatings: this.suiteRatings
    };
  }
```

(d) Add `pushLog` (near `broadcast`):

```ts
  private pushLog(line: string): void {
    this.logLines = appendLog(this.logLines, stamp(line));
    this.emit("state", this.getState());
  }
```

(e) Handle inbound `log` in `handleConnection`'s data loop — add an `else if`:

```ts
        } else if (message.type === "log") {
          const name = this.clients.get(message.clientId)?.name ?? message.clientId;
          this.pushLog(`${name} ${message.line}`);
        }
```

(f) Log connect/disconnect: in `registerClient`, after setting the client, add `this.pushLog(\`客户端已连接：${client.name}\`);` (before the existing `this.emit`). In `handleClientGone`, after `markClientDisconnected`, add `this.pushLog(\`客户端断开：${this.clients.get(clientId)?.name ?? clientId}\`);`.

(g) Log dispatch in `dispatchNext`: right after `this.testingClientId = nextId;`, add:
```ts
      this.pushLog(`派发测试给 ${client?.name ?? nextId}`);
```
(`client` is the `const client = this.clients.get(nextId)` already in that scope.)

(h) Log completion in `handleTestComplete`: after computing the client, add `this.pushLog(\`${client?.name ?? clientId} 测试完成\`);` (use the `const client` already fetched there).

(i) In `finalizeRun`, after building `report` and setting `this.latestReport = report;`, add:
```ts
    this.suiteRatings = { ...this.suiteRatings, [plan.suiteId]: report.summary.rating };
    this.pushLog(`报告就绪：评级 ${report.summary.rating}`);
    this.broadcast({ type: "suite-complete", suiteId: plan.suiteId, rating: report.summary.rating });
```

(j) Clear log on `close()` is NOT required (keep history), but reset `suiteRatings` is also NOT required. Leave both intact across runs.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: all control-channel tests PASS.

Run: `npm run build`
Expected: clean (all session-state required fields now satisfied).

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 5: Commit (server + types + client if not yet committed)**

```bash
git add src/shared/types.ts src/main/controlServer.ts src/main/controlClient.ts tests/unit/controlChannel.test.ts
git commit -m "feat: server relays logs, records suite ratings, broadcasts completion"
```

---

## Task 6: Renderer — log console + suite coloring

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add LogConsole + ratingClass and wire both screens**

In `src/renderer/App.tsx`:

(a) Update the React import to include `useRef`:

```ts
import { useEffect, useRef, useState } from "react";
```

(b) Add `ServerSessionState`/`ClientSessionState` rating type usage. Add these helpers at the bottom of the file (next to `format`):

```tsx
type Rating = "优秀" | "合格" | "风险" | "不合格";

function ratingClass(rating: Rating | undefined): string {
  if (rating === "优秀" || rating === "合格") return "suite-pass";
  if (rating === "风险") return "suite-risk";
  if (rating === "不合格") return "suite-fail";
  return "";
}

function LogConsole({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <pre className="log-console" ref={ref}>
      {lines.join("\n")}
    </pre>
  );
}
```

(c) In `ServerScreen`, color the suite buttons and add the log console. Replace the suite-list `<button>` and add the log panel. Change the suite button to:

```tsx
            {suites.map((suite) => {
              const colorClass =
                state?.activePlan?.suiteId === suite.id ? "suite-running" : ratingClass(state?.suiteRatings[suite.id]);
              return (
                <button
                  key={suite.id}
                  type="button"
                  className={`suite-button ${colorClass}`.trim()}
                  disabled={testing || !hasClients}
                  onClick={() => void startTest(suite.id)}
                >
                  <strong>{suite.label}</strong>
                  <span>{suite.description}</span>
                </button>
              );
            })}
```

And immediately AFTER the `{reportHtml ? (...) : null}` block inside the suite panel, add:

```tsx
          <h2>运行日志</h2>
          <LogConsole lines={state?.log ?? []} />
```

(d) In `ClientScreen`, add a current-suite status bar and the log console. Right after the `<header>` (before `<section className="panel">`), add the status bar:

```tsx
      {state?.currentSuite ? (
        <div
          className={`suite-status ${
            state.currentSuite.status === "running" ? "suite-running" : ratingClass(state.currentSuite.status)
          }`.trim()}
        >
          当前套件：{state.currentSuite.label} ·{" "}
          {state.currentSuite.status === "running" ? "进行中" : state.currentSuite.status}
        </div>
      ) : null}
```

And at the END of the `<section className="panel">` (after the `{connected ? (...) : null}` test block), add:

```tsx
        <h2>运行日志</h2>
        <LogConsole lines={state?.log ?? []} />
```

- [ ] **Step 2: Add styles**

Append to `src/renderer/styles.css`:

```css
.log-console {
  background: #0f1720;
  color: #d6e2ec;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  height: 220px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.suite-status {
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-weight: 650;
  background: #eef3f6;
}

.suite-running {
  background: #1261a6;
  color: #fff;
  animation: suitePulse 1.2s ease-in-out infinite;
}

.suite-pass {
  background: #1b873f;
  color: #fff;
}

.suite-risk {
  background: #c79a00;
  color: #fff;
}

.suite-fail {
  background: #c0392b;
  color: #fff;
}

.suite-button.suite-pass span,
.suite-button.suite-risk span,
.suite-button.suite-fail span,
.suite-button.suite-running span {
  color: rgba(255, 255, 255, 0.85);
}

@keyframes suitePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}
```

- [ ] **Step 3: Build + e2e**

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: PASS (2). The electron smoke clicks 作为服务器 and asserts suite labels visible; buttons still render with the extra color class.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: live log console and rating-colored suites in the UI"
```

---

## Task 7: Docs + full verification

**Files:**
- Modify: `docs/two-machine-verification.md`
- Modify: `assets/iperf3/README.md`

- [ ] **Step 1: Note the iperf3 ≥ 3.17 requirement**

In `assets/iperf3/README.md`, append:

```md

## Version requirement

The app uses `iperf3 --json-stream` for per-second live progress, which requires
**iperf3 ≥ 3.17**. Older builds (e.g. 3.1.x) do not support `--json-stream` and
will fail every phase. Use a 3.17+ binary on every platform.
```

- [ ] **Step 2: Add the log/coloring checks to the verification doc**

In `docs/two-machine-verification.md`, after the "## Suite run (server-orchestrated)" section, add:

```md
## Live progress + suite coloring

9. **During a suite run:** both the server 运行日志 and the client 运行日志 scroll
   with per-second lines like `TCP 上行 3s: 137.0 Mbps` (server lines are
   prefixed with the client name).
10. **While running:** the suite button (server) and the client 当前套件 bar show
    blue/pulsing; on completion they turn green (优秀/合格), amber (风险), or red
    (不合格) per the report rating.
```

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all unit tests pass (logBuffer, iperfParser stream tests, controlChannel incl. logging/coloring, controlProtocol, discovery, iperfServer, reportGenerator, testPlans).

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: 2 pass.

- [ ] **Step 4: Commit**

```bash
git add docs/two-machine-verification.md assets/iperf3/README.md
git commit -m "docs: note iperf3 3.17 requirement and live-progress verification"
```

---

## Self-Review Checklist

- **Spec coverage:** per-second streaming via `--json-stream` + `onInterval` (Task 3); log buffer (Task 1); ControlMessage `log`/`suite-complete` + state fields (Task 2); client log relay + currentSuite (Task 4); server log relay + suiteRatings + broadcast (Task 5); LogConsole + suite coloring on both screens (Task 6); iperf 3.17 note + verification doc (Task 7).
- **Type consistency:** `IntervalUpdate`/`OnInterval`/`intervalUpdate`/`extractEndMetrics` (Task 3) used by client (Task 4). `log`/`suiteRatings`/`currentSuite`/`testingClientId` field names consistent across types (Task 2), server (Task 5), client (Task 4), UI (Task 6). `suite-complete`/`log` message shapes match across client+server. `Rating` in UI matches `ReportSummary["rating"]`. `runIperf(input, onInterval?)` 2-arg signature consistent with `IperfExecutor = typeof runIperf` so existing fakes (1-arg) still satisfy it.
- **Placeholder scan:** none.
- **Existing tests:** iperfParser rewritten for the new format; existing controlChannel fakes are 1-arg and remain valid (onInterval optional). logBuffer/stamp pass an explicit Date in tests for determinism.
```
