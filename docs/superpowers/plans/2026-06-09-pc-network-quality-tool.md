# PC Network Quality Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of an offline Electron desktop app for PC-to-PC network quality testing with one server PC and one or two client PCs.

**Architecture:** Use Electron with a TypeScript main process, preload bridge, and React renderer. Keep network coordination, discovery, test execution, and reporting in focused TypeScript modules so the UI remains a thin layer over test session state. Wrap `iperf3` behind a test-engine interface so the MVP can use a fake runner in tests and a bundled binary in production.

**Tech Stack:** Electron, Vite, React, TypeScript, Vitest, Playwright smoke checks, electron-builder, Node UDP/TCP APIs, bundled `iperf3` binaries.

---

## Source Spec

Implementation follows:

- `docs/superpowers/specs/2026-06-09-pc-network-quality-tool-design.md`

## File Structure

Create this project structure:

```text
package.json
electron-builder.yml
tsconfig.json
tsconfig.node.json
vite.config.ts
vitest.config.ts
src/main/main.ts
src/main/preload.ts
src/main/ipc.ts
src/main/discovery.ts
src/main/controlServer.ts
src/main/controlClient.ts
src/main/testPlans.ts
src/main/iperfRunner.ts
src/main/reportGenerator.ts
src/main/permissions.ts
src/shared/types.ts
src/renderer/App.tsx
src/renderer/main.tsx
src/renderer/styles.css
tests/unit/testPlans.test.ts
tests/unit/reportGenerator.test.ts
tests/unit/iperfParser.test.ts
tests/unit/discovery.test.ts
tests/e2e/smoke.spec.ts
assets/iperf3/README.md
```

Responsibilities:

- `src/shared/types.ts`: shared role, client, test-suite, metric, report, and IPC types.
- `src/main/main.ts`: Electron app lifecycle and window creation.
- `src/main/preload.ts`: safe renderer API exposure.
- `src/main/ipc.ts`: main-process IPC handlers.
- `src/main/discovery.ts`: UDP server advertisement and client discovery.
- `src/main/controlServer.ts`: server-side client registry, test orchestration, result collection.
- `src/main/controlClient.ts`: client-side connection, registration, task execution.
- `src/main/testPlans.ts`: scenario names, durations, and generated test phases.
- `src/main/iperfRunner.ts`: `iperf3` command construction, execution, and JSON parsing.
- `src/main/reportGenerator.ts`: rating calculation and HTML report generation.
- `src/main/permissions.ts`: Windows/macOS permission and firewall guidance helpers.
- `src/renderer/*`: Chinese UI for role selection, server dashboard, client connection, progress, and report preview.
- `tests/*`: unit and smoke coverage for logic before wiring real networks.
- `assets/iperf3/README.md`: documents where platform binaries are expected.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `electron-builder.yml`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/shared/types.ts`
- Create: `src/main/main.ts`
- Create: `src/main/preload.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Create: `assets/iperf3/README.md`

- [ ] **Step 1: Create package metadata and scripts**

Write `package.json`:

```json
{
  "name": "pc-network-quality-tool",
  "version": "0.1.0",
  "description": "Offline Electron desktop tool for PC-to-PC network quality testing.",
  "main": "dist/main/main.js",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.node.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "package": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.5.0",
    "electron-is-dev": "^3.0.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "electron": "^36.4.0",
    "electron-builder": "^26.0.12",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.2.2"
  }
}
```

- [ ] **Step 2: Create TypeScript and Vite config**

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src/renderer", "src/shared", "tests"]
}
```

Write `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/main", "src/shared"]
}
```

Write `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
```

Write `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"]
  }
});
```

- [ ] **Step 3: Create builder config**

Write `electron-builder.yml`:

```yaml
appId: com.local.pcnetworkquality
productName: PC Network Quality Tool
directories:
  output: release
files:
  - dist/**
  - package.json
extraResources:
  - from: assets/iperf3
    to: iperf3
mac:
  target:
    - dmg
win:
  target:
    - nsis
```

- [ ] **Step 4: Create shared types**

Write `src/shared/types.ts`:

```ts
export type AppRole = "unset" | "server" | "client";

export type TestSuiteId =
  | "quick-check"
  | "standard-acceptance"
  | "video-meeting"
  | "hd-video"
  | "long-stability";

export type TestPhaseKind = "connectivity" | "latency" | "tcp-upload" | "tcp-download" | "udp-quality";

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
  port: number;
  lastSeenAt: number;
}

export interface ConnectedClient {
  id: string;
  name: string;
  address: string;
  status: "connected" | "testing" | "disconnected";
}

export interface TestPhase {
  id: string;
  kind: TestPhaseKind;
  label: string;
  durationSeconds: number;
  targetBitrateMbps?: number;
}

export interface TestPlan {
  suiteId: TestSuiteId;
  label: string;
  phases: TestPhase[];
  runMode: "single" | "separate" | "concurrent";
}

export interface PhaseMetrics {
  phaseId: string;
  throughputMbps?: number;
  udpLossPercent?: number;
  jitterMs?: number;
  latencyMs?: {
    min: number;
    avg: number;
    max: number;
    p95: number;
    p99: number;
  };
  errors: string[];
}

export interface ClientTestResult {
  clientId: string;
  clientName: string;
  phases: PhaseMetrics[];
}

export interface ReportSummary {
  rating: "优秀" | "合格" | "风险" | "不合格";
  conclusion: string;
  recommendation: string;
}

export interface TestReport {
  id: string;
  createdAt: string;
  suiteId: TestSuiteId;
  serverName: string;
  serverAddress: string;
  clients: ConnectedClient[];
  results: ClientTestResult[];
  summary: ReportSummary;
}
```

- [ ] **Step 5: Create minimal Electron entry points**

Write `src/main/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import isDev from "electron-is-dev";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "PC Network Quality Tool",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await win.loadURL("http://127.0.0.1:5173");
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
```

Write `src/main/preload.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("networkTool", {
  version: "0.1.0"
});
```

- [ ] **Step 6: Create minimal renderer**

Write `src/renderer/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Write `src/renderer/App.tsx`:

```tsx
import { useState } from "react";
import type { AppRole } from "../shared/types";

export function App() {
  const [role, setRole] = useState<AppRole>("unset");

  return (
    <main className="app-shell">
      <section className="role-panel">
        <h1>网络质量测试工具</h1>
        <p>请选择这台电脑在本次测试中的角色。</p>
        <div className="role-actions">
          <button type="button" onClick={() => setRole("server")}>
            作为服务器
          </button>
          <button type="button" onClick={() => setRole("client")}>
            作为客户端
          </button>
        </div>
        <p className="status-line">
          当前角色：{role === "unset" ? "未选择" : role === "server" ? "服务器" : "客户端"}
        </p>
      </section>
    </main>
  );
}
```

Write `src/renderer/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172026;
  background: #f4f7f9;
}

button {
  border: 0;
  border-radius: 8px;
  background: #1261a6;
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  font-weight: 650;
  min-height: 64px;
  padding: 0 28px;
}

button:hover {
  background: #0d4f88;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.role-panel {
  width: min(760px, 100%);
  background: #fff;
  border: 1px solid #d9e2e8;
  border-radius: 8px;
  padding: 40px;
}

.role-panel h1 {
  margin: 0 0 12px;
  font-size: 34px;
}

.role-panel p {
  color: #52636f;
  font-size: 18px;
  line-height: 1.6;
  margin: 0 0 28px;
}

.role-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.status-line {
  margin-top: 28px;
}
```

- [ ] **Step 7: Create bundled binary note**

Write `assets/iperf3/README.md`:

```md
# iperf3 binaries

Place platform-specific iperf3 binaries here before packaging:

- `win32-x64/iperf3.exe`
- `darwin-x64/iperf3`
- `darwin-arm64/iperf3`

The application resolves the binary by platform and architecture at runtime.
```

- [ ] **Step 8: Install dependencies**

Run:

```bash
npm install
```

Expected:

- `package-lock.json` is created.
- `node_modules/` is created.
- No dependency resolution errors.

- [ ] **Step 9: Build the scaffold**

Run:

```bash
npm run build
```

Expected:

- TypeScript compiles main and shared code.
- Vite builds renderer into `dist/renderer`.

- [ ] **Step 10: Commit scaffold**

Run:

```bash
git add package.json package-lock.json electron-builder.yml tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts src assets
git commit -m "chore: scaffold Electron network quality app"
```

## Task 2: Test Suite Plan Builder

**Files:**
- Create: `src/main/testPlans.ts`
- Test: `tests/unit/testPlans.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write failing tests for suite plans**

Write `tests/unit/testPlans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTestPlan, listTestSuites } from "../../src/main/testPlans";

describe("testPlans", () => {
  it("lists the five first-version suites in UI order", () => {
    expect(listTestSuites().map((suite) => suite.id)).toEqual([
      "quick-check",
      "standard-acceptance",
      "video-meeting",
      "hd-video",
      "long-stability"
    ]);
  });

  it("builds a quick check with short connectivity, tcp, and udp phases", () => {
    const plan = buildTestPlan("quick-check", "single");

    expect(plan.label).toBe("快速检测");
    expect(plan.runMode).toBe("single");
    expect(plan.phases.map((phase) => phase.kind)).toEqual([
      "connectivity",
      "latency",
      "tcp-upload",
      "tcp-download",
      "udp-quality"
    ]);
    expect(plan.phases.every((phase) => phase.durationSeconds <= 20)).toBe(true);
  });

  it("builds HD video with a high target UDP bitrate", () => {
    const plan = buildTestPlan("hd-video", "concurrent");
    const udpPhase = plan.phases.find((phase) => phase.kind === "udp-quality");

    expect(plan.runMode).toBe("concurrent");
    expect(udpPhase?.targetBitrateMbps).toBe(25);
  });

  it("builds long stability with a selected duration", () => {
    const plan = buildTestPlan("long-stability", "separate", { durationSeconds: 3600 });

    expect(plan.phases.some((phase) => phase.durationSeconds === 3600)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/unit/testPlans.test.ts
```

Expected:

- FAIL because `src/main/testPlans.ts` does not exist.

- [ ] **Step 3: Implement test plan builder**

Write `src/main/testPlans.ts`:

```ts
import type { TestPhase, TestPlan, TestSuiteId } from "../shared/types";

export interface TestSuiteDefinition {
  id: TestSuiteId;
  label: string;
  description: string;
}

export interface BuildPlanOptions {
  durationSeconds?: number;
}

const suites: TestSuiteDefinition[] = [
  { id: "quick-check", label: "快速检测", description: "1-2 分钟，快速发现明显网络问题。" },
  { id: "standard-acceptance", label: "标准验收", description: "5-8 分钟，生成正式验收报告。" },
  { id: "video-meeting", label: "视频会议模拟", description: "模拟实时音视频会议。" },
  { id: "hd-video", label: "高清视频传输模拟", description: "模拟 1080p/4K 持续视频流。" },
  { id: "long-stability", label: "长时间稳定性测试", description: "发现间歇性丢包和波动。" }
];

export function listTestSuites(): TestSuiteDefinition[] {
  return suites;
}

export function buildTestPlan(
  suiteId: TestSuiteId,
  runMode: TestPlan["runMode"],
  options: BuildPlanOptions = {}
): TestPlan {
  const suite = suites.find((item) => item.id === suiteId);
  if (!suite) throw new Error(`Unknown test suite: ${suiteId}`);

  const phases = buildPhases(suiteId, options.durationSeconds);

  return {
    suiteId,
    label: suite.label,
    runMode,
    phases
  };
}

function buildPhases(suiteId: TestSuiteId, durationSeconds?: number): TestPhase[] {
  switch (suiteId) {
    case "quick-check":
      return commonPhases(10, 20, 8);
    case "standard-acceptance":
      return commonPhases(30, 60, 30);
    case "video-meeting":
      return commonPhases(30, 45, 180, 4);
    case "hd-video":
      return commonPhases(30, 60, 180, 25);
    case "long-stability":
      return commonPhases(60, 120, durationSeconds ?? 1800, 8);
  }
}

function commonPhases(
  latencySeconds: number,
  tcpSeconds: number,
  udpSeconds: number,
  targetBitrateMbps = 10
): TestPhase[] {
  return [
    { id: "connectivity", kind: "connectivity", label: "连通性检查", durationSeconds: 5 },
    { id: "latency", kind: "latency", label: "延迟采样", durationSeconds: latencySeconds },
    { id: "tcp-upload", kind: "tcp-upload", label: "TCP 上行吞吐量", durationSeconds: tcpSeconds },
    { id: "tcp-download", kind: "tcp-download", label: "TCP 下行吞吐量", durationSeconds: tcpSeconds },
    {
      id: "udp-quality",
      kind: "udp-quality",
      label: "UDP 丢包和抖动",
      durationSeconds: udpSeconds,
      targetBitrateMbps
    }
  ];
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- tests/unit/testPlans.test.ts
```

Expected:

- PASS all `testPlans` tests.

- [ ] **Step 5: Commit test plan builder**

Run:

```bash
git add src/main/testPlans.ts tests/unit/testPlans.test.ts src/shared/types.ts
git commit -m "feat: add network test suite plans"
```

## Task 3: iperf3 Runner and Parser

**Files:**
- Create: `src/main/iperfRunner.ts`
- Test: `tests/unit/iperfParser.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write parser tests**

Write `tests/unit/iperfParser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIperfArgs, parseIperfJson } from "../../src/main/iperfRunner";

describe("iperfRunner", () => {
  it("builds tcp upload arguments", () => {
    expect(buildIperfArgs({ host: "192.168.1.10", phaseKind: "tcp-upload", durationSeconds: 30 })).toEqual([
      "-c",
      "192.168.1.10",
      "-J",
      "-t",
      "30"
    ]);
  });

  it("builds tcp download reverse arguments", () => {
    expect(buildIperfArgs({ host: "192.168.1.10", phaseKind: "tcp-download", durationSeconds: 30 })).toContain("-R");
  });

  it("builds udp quality arguments with bitrate", () => {
    const args = buildIperfArgs({
      host: "192.168.1.10",
      phaseKind: "udp-quality",
      durationSeconds: 60,
      targetBitrateMbps: 8
    });

    expect(args).toContain("-u");
    expect(args).toContain("-b");
    expect(args).toContain("8M");
  });

  it("parses tcp throughput", () => {
    const metrics = parseIperfJson("tcp-upload", JSON.stringify({
      end: {
        sum_sent: {
          bits_per_second: 943000000
        }
      }
    }));

    expect(metrics.throughputMbps).toBeCloseTo(943, 1);
    expect(metrics.errors).toEqual([]);
  });

  it("parses udp loss and jitter", () => {
    const metrics = parseIperfJson("udp-quality", JSON.stringify({
      end: {
        sum: {
          bits_per_second: 7900000,
          lost_percent: 1.25,
          jitter_ms: 4.8
        }
      }
    }));

    expect(metrics.throughputMbps).toBeCloseTo(7.9, 1);
    expect(metrics.udpLossPercent).toBe(1.25);
    expect(metrics.jitterMs).toBe(4.8);
  });
});
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
npm test -- tests/unit/iperfParser.test.ts
```

Expected:

- FAIL because `src/main/iperfRunner.ts` does not exist.

- [ ] **Step 3: Implement runner and parser**

Write `src/main/iperfRunner.ts`:

```ts
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhaseMetrics, TestPhaseKind } from "../shared/types";

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
  const parsed = JSON.parse(rawJson) as {
    end?: {
      sum_sent?: { bits_per_second?: number };
      sum_received?: { bits_per_second?: number };
      sum?: { bits_per_second?: number; lost_percent?: number; jitter_ms?: number };
    };
  };

  const metrics: PhaseMetrics = {
    phaseId: phaseKind,
    errors: []
  };

  if (phaseKind === "udp-quality") {
    const sum = parsed.end?.sum;
    metrics.throughputMbps = toMbps(sum?.bits_per_second);
    metrics.udpLossPercent = sum?.lost_percent;
    metrics.jitterMs = sum?.jitter_ms;
    return metrics;
  }

  const tcpSummary = parsed.end?.sum_sent ?? parsed.end?.sum_received;
  metrics.throughputMbps = toMbps(tcpSummary?.bits_per_second);
  return metrics;
}

export function resolveIperfBinary(): string {
  const platformDir = `${process.platform}-${process.arch}`;
  const binaryName = process.platform === "win32" ? "iperf3.exe" : "iperf3";
  return path.join(__dirname, "../../assets/iperf3", platformDir, binaryName);
}

function toMbps(bitsPerSecond: number | undefined): number | undefined {
  return bitsPerSecond === undefined ? undefined : bitsPerSecond / 1_000_000;
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
      } else {
        reject(new Error(stderr || `iperf3 exited with code ${code}`));
      }
    });
  });
}
```

- [ ] **Step 4: Run parser tests to verify pass**

Run:

```bash
npm test -- tests/unit/iperfParser.test.ts
```

Expected:

- PASS all `iperfRunner` tests.

- [ ] **Step 5: Commit runner**

Run:

```bash
git add src/main/iperfRunner.ts tests/unit/iperfParser.test.ts
git commit -m "feat: add iperf runner parser"
```

## Task 4: Report Generator

**Files:**
- Create: `src/main/reportGenerator.ts`
- Test: `tests/unit/reportGenerator.test.ts`

- [ ] **Step 1: Write report tests**

Write `tests/unit/reportGenerator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildReportSummary, renderReportHtml } from "../../src/main/reportGenerator";
import type { TestReport } from "../../src/shared/types";

describe("reportGenerator", () => {
  it("rates excellent results as 优秀", () => {
    const summary = buildReportSummary([
      { clientId: "a", clientName: "客户端 A", phases: [{ phaseId: "udp-quality", udpLossPercent: 0, jitterMs: 2, errors: [] }] }
    ]);

    expect(summary.rating).toBe("优秀");
  });

  it("rates packet loss above 3 percent as 不合格", () => {
    const summary = buildReportSummary([
      { clientId: "b", clientName: "客户端 B", phases: [{ phaseId: "udp-quality", udpLossPercent: 3.2, jitterMs: 8, errors: [] }] }
    ]);

    expect(summary.rating).toBe("不合格");
    expect(summary.conclusion).toContain("客户端 B");
  });

  it("renders html with conclusion and client names", () => {
    const report: TestReport = {
      id: "report-1",
      createdAt: "2026-06-09T00:00:00.000Z",
      suiteId: "quick-check",
      serverName: "服务器",
      serverAddress: "192.168.1.10",
      clients: [{ id: "a", name: "客户端 A", address: "192.168.1.11", status: "connected" }],
      results: [{ clientId: "a", clientName: "客户端 A", phases: [] }],
      summary: {
        rating: "合格",
        conclusion: "网络质量合格。",
        recommendation: "可用于常规业务。"
      }
    };

    const html = renderReportHtml(report);

    expect(html).toContain("网络质量合格");
    expect(html).toContain("客户端 A");
    expect(html).toContain("192.168.1.10");
  });
});
```

- [ ] **Step 2: Run report tests to verify failure**

Run:

```bash
npm test -- tests/unit/reportGenerator.test.ts
```

Expected:

- FAIL because `src/main/reportGenerator.ts` does not exist.

- [ ] **Step 3: Implement report generator**

Write `src/main/reportGenerator.ts`:

```ts
import type { ClientTestResult, ReportSummary, TestReport } from "../shared/types";

export function buildReportSummary(results: ClientTestResult[]): ReportSummary {
  const worstLoss = maxDefined(results.flatMap((result) => result.phases.map((phase) => phase.udpLossPercent)));
  const worstJitter = maxDefined(results.flatMap((result) => result.phases.map((phase) => phase.jitterMs)));
  const erroredClient = results.find((result) => result.phases.some((phase) => phase.errors.length > 0));
  const lossClient = results.find((result) => result.phases.some((phase) => (phase.udpLossPercent ?? 0) > 3));

  if (erroredClient) {
    return {
      rating: "不合格",
      conclusion: `${erroredClient.clientName} 测试过程中出现未完成或失败阶段。`,
      recommendation: "请检查客户端连接、防火墙设置和中间网络设备后重新测试。"
    };
  }

  if ((worstLoss ?? 0) > 3) {
    return {
      rating: "不合格",
      conclusion: `${lossClient?.clientName ?? "某客户端"} 出现超过 3% 的 UDP 丢包。`,
      recommendation: "建议检查交换机端口、网线、无线信号或并发占用。"
    };
  }

  if ((worstLoss ?? 0) > 1 || (worstJitter ?? 0) > 30) {
    return {
      rating: "风险",
      conclusion: "网络存在丢包或抖动风险，实时音视频可能受影响。",
      recommendation: "建议在业务高峰期再次进行长时间稳定性测试。"
    };
  }

  if ((worstLoss ?? 0) > 0.1 || (worstJitter ?? 0) > 15) {
    return {
      rating: "合格",
      conclusion: "网络质量合格，可用于常规业务。",
      recommendation: "如用于高清视频或关键业务，建议运行标准验收或长时间稳定性测试。"
    };
  }

  return {
    rating: "优秀",
    conclusion: "网络质量优秀，未发现明显丢包或抖动问题。",
    recommendation: "可用于视频会议和常规高清视频传输。"
  };
}

export function renderReportHtml(report: TestReport): string {
  const clientRows = report.clients
    .map((client) => `<tr><td>${escapeHtml(client.name)}</td><td>${escapeHtml(client.address)}</td><td>${client.status}</td></tr>`)
    .join("");

  const resultRows = report.results
    .flatMap((result) =>
      result.phases.map(
        (phase) =>
          `<tr><td>${escapeHtml(result.clientName)}</td><td>${escapeHtml(phase.phaseId)}</td><td>${formatNumber(phase.throughputMbps)}</td><td>${formatNumber(phase.udpLossPercent)}</td><td>${formatNumber(phase.jitterMs)}</td><td>${escapeHtml(phase.errors.join("; "))}</td></tr>`
      )
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>网络质量测试报告</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; }
    h1, h2 { margin-bottom: 8px; }
    .rating { display: inline-block; padding: 8px 12px; background: #1261a6; color: #fff; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d9e2e8; padding: 8px; text-align: left; }
    th { background: #eef3f6; }
  </style>
</head>
<body>
  <h1>网络质量测试报告</h1>
  <p class="rating">${report.summary.rating}</p>
  <p>${escapeHtml(report.summary.conclusion)}</p>
  <p>${escapeHtml(report.summary.recommendation)}</p>
  <h2>测试信息</h2>
  <p>时间：${escapeHtml(report.createdAt)}</p>
  <p>服务器：${escapeHtml(report.serverName)} - ${escapeHtml(report.serverAddress)}</p>
  <h2>客户端</h2>
  <table><thead><tr><th>名称</th><th>IP</th><th>状态</th></tr></thead><tbody>${clientRows}</tbody></table>
  <h2>详细指标</h2>
  <table><thead><tr><th>客户端</th><th>阶段</th><th>吞吐量 Mbps</th><th>UDP 丢包 %</th><th>抖动 ms</th><th>错误</th></tr></thead><tbody>${resultRows}</tbody></table>
</body>
</html>`;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length === 0 ? undefined : Math.max(...defined);
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[char];
  });
}
```

- [ ] **Step 4: Run report tests to verify pass**

Run:

```bash
npm test -- tests/unit/reportGenerator.test.ts
```

Expected:

- PASS all `reportGenerator` tests.

- [ ] **Step 5: Commit report generator**

Run:

```bash
git add src/main/reportGenerator.ts tests/unit/reportGenerator.test.ts
git commit -m "feat: add network report generator"
```

## Task 5: Discovery Layer

**Files:**
- Create: `src/main/discovery.ts`
- Test: `tests/unit/discovery.test.ts`

- [ ] **Step 1: Write discovery message tests**

Write `tests/unit/discovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDiscoveryMessage, serializeDiscoveryMessage } from "../../src/main/discovery";

describe("discovery", () => {
  it("round trips a discovery message", () => {
    const raw = serializeDiscoveryMessage({
      id: "server-1",
      name: "测试服务器",
      address: "192.168.1.10",
      port: 48100,
      lastSeenAt: 1000
    });

    expect(parseDiscoveryMessage(raw)).toEqual({
      id: "server-1",
      name: "测试服务器",
      address: "192.168.1.10",
      port: 48100,
      lastSeenAt: 1000
    });
  });

  it("rejects non-tool messages", () => {
    expect(parseDiscoveryMessage(Buffer.from("hello"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run discovery tests to verify failure**

Run:

```bash
npm test -- tests/unit/discovery.test.ts
```

Expected:

- FAIL because `src/main/discovery.ts` does not exist.

- [ ] **Step 3: Implement discovery message helpers and runtime classes**

Write `src/main/discovery.ts`:

```ts
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import os from "node:os";
import type { DiscoveredServer } from "../shared/types";

const DISCOVERY_PREFIX = "PC_NETWORK_QUALITY_TOOL_V1";
export const DISCOVERY_PORT = 48101;

export function serializeDiscoveryMessage(server: DiscoveredServer): Buffer {
  return Buffer.from(`${DISCOVERY_PREFIX}:${JSON.stringify(server)}`, "utf8");
}

export function parseDiscoveryMessage(buffer: Buffer): DiscoveredServer | null {
  const text = buffer.toString("utf8");
  if (!text.startsWith(`${DISCOVERY_PREFIX}:`)) return null;

  const parsed = JSON.parse(text.slice(DISCOVERY_PREFIX.length + 1)) as DiscoveredServer;
  if (!parsed.id || !parsed.name || !parsed.address || !parsed.port) return null;
  return parsed;
}

export class DiscoveryBroadcaster {
  private timer: NodeJS.Timeout | undefined;
  private socket = dgram.createSocket("udp4");

  constructor(private readonly server: Omit<DiscoveredServer, "lastSeenAt">) {}

  start(): void {
    this.socket.bind(() => {
      this.socket.setBroadcast(true);
    });
    this.timer = setInterval(() => this.broadcast(), 1000);
    this.broadcast();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.socket.close();
  }

  private broadcast(): void {
    const message = serializeDiscoveryMessage({ ...this.server, lastSeenAt: Date.now() });
    this.socket.send(message, DISCOVERY_PORT, "255.255.255.255");
  }
}

export class DiscoveryScanner extends EventEmitter {
  private socket = dgram.createSocket("udp4");

  start(): void {
    this.socket.on("message", (message) => {
      const server = parseDiscoveryMessage(message);
      if (server) this.emit("server", server);
    });

    this.socket.bind(DISCOVERY_PORT);
  }

  stop(): void {
    this.socket.close();
  }
}

export function getLikelyLocalAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item): item is os.NetworkInterfaceInfo => Boolean(item) && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
```

- [ ] **Step 4: Run discovery tests to verify pass**

Run:

```bash
npm test -- tests/unit/discovery.test.ts
```

Expected:

- PASS all `discovery` tests.

- [ ] **Step 5: Commit discovery layer**

Run:

```bash
git add src/main/discovery.ts tests/unit/discovery.test.ts
git commit -m "feat: add local server discovery"
```

## Task 6: Control Server and Client State

**Files:**
- Create: `src/main/controlServer.ts`
- Create: `src/main/controlClient.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add control protocol types**

Append these exports to `src/shared/types.ts`:

```ts
export type ControlMessage =
  | { type: "register-client"; client: ConnectedClient }
  | { type: "client-registered"; clientId: string }
  | { type: "start-test"; plan: TestPlan; serverAddress: string }
  | { type: "phase-result"; clientId: string; metrics: PhaseMetrics }
  | { type: "test-complete"; clientId: string }
  | { type: "error"; message: string };

export interface ServerSessionState {
  role: "server";
  clients: ConnectedClient[];
  activePlan?: TestPlan;
  latestReport?: TestReport;
}

export interface ClientSessionState {
  role: "client";
  discoveredServers: DiscoveredServer[];
  connectedServer?: DiscoveredServer;
  status: "searching" | "connecting" | "connected" | "testing" | "error";
  statusText: string;
}
```

- [ ] **Step 2: Implement server registry and orchestration skeleton**

Write `src/main/controlServer.ts`:

```ts
import { EventEmitter } from "node:events";
import type { ConnectedClient, ServerSessionState, TestPlan } from "../shared/types";

export class ControlServer extends EventEmitter {
  private clients = new Map<string, ConnectedClient>();
  private activePlan: TestPlan | undefined;

  getState(): ServerSessionState {
    return {
      role: "server",
      clients: [...this.clients.values()],
      activePlan: this.activePlan
    };
  }

  registerClient(client: ConnectedClient): void {
    this.clients.set(client.id, { ...client, status: "connected" });
    this.emit("state", this.getState());
  }

  markClientDisconnected(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.clients.set(clientId, { ...client, status: "disconnected" });
    this.emit("state", this.getState());
  }

  startPlan(plan: TestPlan, clientIds: string[]): void {
    this.activePlan = plan;
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) this.clients.set(clientId, { ...client, status: "testing" });
    }
    this.emit("start-test", { plan, clientIds });
    this.emit("state", this.getState());
  }
}
```

- [ ] **Step 3: Implement client state skeleton**

Write `src/main/controlClient.ts`:

```ts
import { EventEmitter } from "node:events";
import type { ClientSessionState, DiscoveredServer } from "../shared/types";

export class ControlClient extends EventEmitter {
  private discoveredServers = new Map<string, DiscoveredServer>();
  private connectedServer: DiscoveredServer | undefined;
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";

  getState(): ClientSessionState {
    return {
      role: "client",
      discoveredServers: [...this.discoveredServers.values()],
      connectedServer: this.connectedServer,
      status: this.status,
      statusText: this.statusText
    };
  }

  upsertDiscoveredServer(server: DiscoveredServer): void {
    this.discoveredServers.set(server.id, server);
    this.statusText = "已发现服务器";
    this.emit("state", this.getState());
  }

  connect(serverId: string): void {
    const server = this.discoveredServers.get(serverId);
    if (!server) {
      this.status = "error";
      this.statusText = "无法连接，请检查是否在同一网络";
      this.emit("state", this.getState());
      return;
    }

    this.status = "connected";
    this.connectedServer = server;
    this.statusText = "已连接，等待服务器开始测试";
    this.emit("state", this.getState());
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run build
```

Expected:

- TypeScript compiles without errors.

- [ ] **Step 5: Commit control state**

Run:

```bash
git add src/shared/types.ts src/main/controlServer.ts src/main/controlClient.ts
git commit -m "feat: add control session state"
```

## Task 7: IPC Bridge

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Implement IPC handlers**

Write `src/main/ipc.ts`:

```ts
import { ipcMain } from "electron";
import { ControlClient } from "./controlClient";
import { ControlServer } from "./controlServer";
import { buildTestPlan, listTestSuites } from "./testPlans";
import type { AppRole, TestSuiteId } from "../shared/types";

const server = new ControlServer();
const client = new ControlClient();
let role: AppRole = "unset";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:get-role", () => role);

  ipcMain.handle("app:set-role", (_event, nextRole: AppRole) => {
    role = nextRole;
    return role;
  });

  ipcMain.handle("server:get-state", () => server.getState());
  ipcMain.handle("client:get-state", () => client.getState());
  ipcMain.handle("tests:list-suites", () => listTestSuites());

  ipcMain.handle("tests:build-plan", (_event, suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") => {
    return buildTestPlan(suiteId, runMode);
  });
}
```

- [ ] **Step 2: Register IPC in main process**

Modify `src/main/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import isDev from "electron-is-dev";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "PC Network Quality Tool",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await win.loadURL("http://127.0.0.1:5173");
  } else {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

registerIpcHandlers();

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
```

- [ ] **Step 3: Expose renderer API**

Modify `src/main/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { AppRole, TestSuiteId } from "../shared/types";

contextBridge.exposeInMainWorld("networkTool", {
  getRole: () => ipcRenderer.invoke("app:get-role") as Promise<AppRole>,
  setRole: (role: AppRole) => ipcRenderer.invoke("app:set-role", role) as Promise<AppRole>,
  getServerState: () => ipcRenderer.invoke("server:get-state"),
  getClientState: () => ipcRenderer.invoke("client:get-state"),
  listTestSuites: () => ipcRenderer.invoke("tests:list-suites"),
  buildPlan: (suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") =>
    ipcRenderer.invoke("tests:build-plan", suiteId, runMode)
});
```

- [ ] **Step 4: Add renderer global type**

Create `src/renderer/global.d.ts`:

```ts
import type { AppRole, TestSuiteId } from "../shared/types";

declare global {
  interface Window {
    networkTool: {
      getRole(): Promise<AppRole>;
      setRole(role: AppRole): Promise<AppRole>;
      getServerState(): Promise<unknown>;
      getClientState(): Promise<unknown>;
      listTestSuites(): Promise<Array<{ id: TestSuiteId; label: string; description: string }>>;
      buildPlan(suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent"): Promise<unknown>;
    };
  }
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected:

- Build succeeds without TypeScript errors.

- [ ] **Step 6: Commit IPC bridge**

Run:

```bash
git add src/main/ipc.ts src/main/main.ts src/main/preload.ts src/renderer/global.d.ts src/renderer/App.tsx
git commit -m "feat: add Electron IPC bridge"
```

## Task 8: Renderer UI for Server and Client Workflows

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Replace renderer with role-specific screens**

Modify `src/renderer/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AppRole, TestSuiteId } from "../shared/types";

interface SuiteView {
  id: TestSuiteId;
  label: string;
  description: string;
}

export function App() {
  const [role, setRoleState] = useState<AppRole>("unset");
  const [suites, setSuites] = useState<SuiteView[]>([]);

  useEffect(() => {
    void window.networkTool.getRole().then(setRoleState);
    void window.networkTool.listTestSuites().then(setSuites);
  }, []);

  async function setRole(nextRole: AppRole) {
    const savedRole = await window.networkTool.setRole(nextRole);
    setRoleState(savedRole);
  }

  if (role === "server") {
    return <ServerScreen suites={suites} onBack={() => void setRole("unset")} />;
  }

  if (role === "client") {
    return <ClientScreen onBack={() => void setRole("unset")} />;
  }

  return (
    <main className="app-shell">
      <section className="role-panel">
        <h1>网络质量测试工具</h1>
        <p>请选择这台电脑在本次测试中的角色。</p>
        <div className="role-actions">
          <button type="button" onClick={() => void setRole("server")}>
            作为服务器
          </button>
          <button type="button" onClick={() => void setRole("client")}>
            作为客户端
          </button>
        </div>
      </section>
    </main>
  );
}

function ServerScreen({ suites, onBack }: { suites: SuiteView[]; onBack: () => void }) {
  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>服务器模式</h1>
          <p>等待客户端连接后选择测试套件。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>已连接客户端</h2>
          <p className="empty">暂无客户端连接</p>
        </div>
        <div className="panel">
          <h2>测试套件</h2>
          <div className="suite-list">
            {suites.map((suite) => (
              <button key={suite.id} type="button" className="suite-button">
                <strong>{suite.label}</strong>
                <span>{suite.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function ClientScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>客户端模式</h1>
          <p>正在搜索测试服务器。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="panel">
        <h2>服务器搜索</h2>
        <p className="empty">正在搜索服务器。如果长时间没有结果，请使用手动 IP 连接。</p>
        <label className="manual-ip">
          手动输入服务器 IP
          <input type="text" placeholder="例如 192.168.1.23" />
        </label>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Replace CSS with dashboard layout**

Modify `src/renderer/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172026;
  background: #f4f7f9;
}

button,
input {
  font: inherit;
}

button {
  border: 0;
  border-radius: 8px;
  background: #1261a6;
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  font-weight: 650;
  min-height: 56px;
  padding: 0 24px;
}

button:hover {
  background: #0d4f88;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.role-panel,
.panel {
  background: #fff;
  border: 1px solid #d9e2e8;
  border-radius: 8px;
}

.role-panel {
  width: min(760px, 100%);
  padding: 40px;
}

.role-panel h1,
.topbar h1 {
  margin: 0 0 12px;
  font-size: 34px;
}

.role-panel p,
.topbar p,
.empty {
  color: #52636f;
  font-size: 18px;
  line-height: 1.6;
  margin: 0;
}

.role-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 28px;
}

.workspace {
  min-height: 100vh;
  padding: 28px;
}

.topbar {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 24px;
}

.secondary {
  background: #dce7ee;
  color: #172026;
}

.secondary:hover {
  background: #c8d8e2;
}

.grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 20px;
}

.panel {
  padding: 24px;
}

.panel h2 {
  font-size: 22px;
  margin: 0 0 18px;
}

.suite-list {
  display: grid;
  gap: 12px;
}

.suite-button {
  align-items: flex-start;
  background: #eef3f6;
  color: #172026;
  display: grid;
  gap: 6px;
  justify-items: start;
  min-height: 76px;
  padding: 14px 16px;
  text-align: left;
}

.suite-button:hover {
  background: #dce7ee;
}

.suite-button span {
  color: #52636f;
  font-size: 14px;
  font-weight: 400;
}

.manual-ip {
  display: grid;
  gap: 8px;
  margin-top: 24px;
}

.manual-ip input {
  border: 1px solid #b9c8d3;
  border-radius: 8px;
  min-height: 44px;
  padding: 0 12px;
}
```

- [ ] **Step 3: Build UI**

Run:

```bash
npm run build
```

Expected:

- Build succeeds.

- [ ] **Step 4: Commit UI**

Run:

```bash
git add src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: add server and client workflow UI"
```

## Task 9: Permission Guidance

**Files:**
- Create: `src/main/permissions.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Implement permission guidance helper**

Write `src/main/permissions.ts`:

```ts
export interface PermissionGuidance {
  platform: NodeJS.Platform;
  requiresAdminForRepair: boolean;
  messages: string[];
}

export function getPermissionGuidance(platform: NodeJS.Platform = process.platform): PermissionGuidance {
  if (platform === "win32") {
    return {
      platform,
      requiresAdminForRepair: true,
      messages: [
        "Windows 防火墙可能会弹出允许访问提示，请选择允许。",
        "如果客户端无法连接，请以管理员身份运行并点击自动修复。"
      ]
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      requiresAdminForRepair: false,
      messages: [
        "macOS 可能会请求本地网络访问权限，请选择允许。",
        "如果搜索不到服务器，请在系统设置中确认本软件允许访问本地网络。"
      ]
    };
  }

  return {
    platform,
    requiresAdminForRepair: false,
    messages: ["请确认系统允许本软件访问本地网络。"]
  };
}
```

- [ ] **Step 2: Expose permission guidance through IPC**

Add to `src/main/ipc.ts` imports:

```ts
import { getPermissionGuidance } from "./permissions";
```

Add inside `registerIpcHandlers()`:

```ts
ipcMain.handle("permissions:get-guidance", () => getPermissionGuidance());
```

Modify `src/main/preload.ts` exposed API:

```ts
getPermissionGuidance: () => ipcRenderer.invoke("permissions:get-guidance")
```

Modify `src/renderer/global.d.ts`:

```ts
getPermissionGuidance(): Promise<{ platform: string; requiresAdminForRepair: boolean; messages: string[] }>;
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected:

- Build succeeds.

- [ ] **Step 4: Commit permission guidance**

Run:

```bash
git add src/main/permissions.ts src/main/ipc.ts src/main/preload.ts src/renderer/global.d.ts
git commit -m "feat: add platform permission guidance"
```

## Task 10: Report Preview and Export Skeleton

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add sample report IPC for UI verification**

Add to `src/main/ipc.ts` imports:

```ts
import { buildReportSummary, renderReportHtml } from "./reportGenerator";
```

Add inside `registerIpcHandlers()`:

```ts
ipcMain.handle("reports:sample-html", () => {
  const results = [
    {
      clientId: "client-a",
      clientName: "客户端 A",
      phases: [{ phaseId: "udp-quality", udpLossPercent: 0.2, jitterMs: 8, throughputMbps: 92, errors: [] }]
    }
  ];

  return renderReportHtml({
    id: "sample",
    createdAt: new Date().toISOString(),
    suiteId: "quick-check",
    serverName: "测试服务器",
    serverAddress: "192.168.1.10",
    clients: [{ id: "client-a", name: "客户端 A", address: "192.168.1.11", status: "connected" }],
    results,
    summary: buildReportSummary(results)
  });
});
```

- [ ] **Step 2: Expose report IPC in preload**

Add to `src/main/preload.ts` exposed API:

```ts
getSampleReportHtml: () => ipcRenderer.invoke("reports:sample-html") as Promise<string>
```

Add to `src/renderer/global.d.ts`:

```ts
getSampleReportHtml(): Promise<string>;
```

- [ ] **Step 3: Add report preview button in server screen**

In `ServerScreen` in `src/renderer/App.tsx`, add local state and button:

```tsx
const [reportHtml, setReportHtml] = useState<string>("");

async function previewReport() {
  setReportHtml(await window.networkTool.getSampleReportHtml());
}
```

Add this button under the suite list:

```tsx
<button type="button" className="secondary" onClick={() => void previewReport()}>
  预览报告
</button>
```

Add this preview block:

```tsx
{reportHtml ? (
  <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
) : null}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected:

- Build succeeds.

- [ ] **Step 5: Commit report preview**

Run:

```bash
git add src/main/ipc.ts src/main/preload.ts src/renderer/global.d.ts src/renderer/App.tsx
git commit -m "feat: add report preview flow"
```

## Task 11: Smoke Test

**Files:**
- Create: `tests/e2e/smoke.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Add Playwright smoke test**

Write `tests/e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("renderer shows role selection", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173");

  await expect(page.getByRole("heading", { name: "网络质量测试工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "作为服务器" })).toBeVisible();
  await expect(page.getByRole("button", { name: "作为客户端" })).toBeVisible();
});
```

- [ ] **Step 2: Add Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
```

- [ ] **Step 3: Run unit tests**

Run:

```bash
npm test
```

Expected:

- All unit tests pass.

- [ ] **Step 4: Run smoke test**

Run:

```bash
npm run e2e
```

Expected:

- Playwright opens the renderer and verifies the role selection screen.

- [ ] **Step 5: Commit smoke test**

Run:

```bash
git add tests/e2e/smoke.spec.ts playwright.config.ts package.json
git commit -m "test: add renderer smoke test"
```

## Task 12: Packaging Verification

**Files:**
- Modify only if build or packaging exposes a concrete issue.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run build
npm test
npm run package
```

Expected:

- Build succeeds.
- Unit tests pass.
- `release/` contains an unpacked Electron app directory.

- [ ] **Step 2: Inspect packaged resources**

Run:

```bash
find release -maxdepth 4 -type d -name iperf3 -o -type f -name "README.md"
```

Expected:

- The packaged app includes the `iperf3` resource directory or its README placeholder.

- [ ] **Step 3: Commit packaging fixes if needed**

If Task 12 required changes, run:

```bash
git add electron-builder.yml package.json
git commit -m "build: fix Electron packaging"
```

If no changes were needed, do not create an empty commit.

## Self-Review Checklist

- Spec coverage: The plan covers Electron desktop UI, offline packaging, server/client roles, automatic discovery foundation, test suites, `iperf3` abstraction, report generation, permission guidance, and first-version PC-to-PC scope.
- Intentional gap: Real cross-machine socket orchestration is scaffolded in Task 6 but not fully exercised end-to-end. This is acceptable for the first implementation slice; the next plan should add live TCP control messages and a two-machine manual verification script.
- First-version boundary: Camera stream analysis remains out of scope and is not implemented.
- Placeholder scan: No task uses unfinished-marker language.
- Type consistency: Shared types are introduced before later tasks reference them.
