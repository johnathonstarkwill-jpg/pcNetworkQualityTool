# Suite Orchestration + Real Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server pick a test suite and run it across all connected clients sequentially, with each client running the suite's iperf phases and streaming results back, and the server aggregating them into a real report rendered inline.

**Architecture:** Server-triggered orchestration over the existing TCP control channel. `ControlServer.startPlan` dispatches the plan to one client at a time, collects `phase-result`/`test-complete` messages, and assembles a `TestReport`. `ControlClient` gains an injectable iperf executor (for tests) and runs the runnable phases on `start-test`.

**Tech Stack:** Electron, TypeScript, Node `net`, Vitest, React.

---

## Source Spec

Implementation follows:

- `docs/superpowers/specs/2026-06-10-suite-orchestration-design.md`

## File Structure

```text
src/shared/types.ts            [modify] add testingClientId? to ServerSessionState
src/main/controlClient.ts      [modify] injectable iperf executor; handle start-test; runPlan; refactor runManualTest
src/main/controlServer.ts      [modify] startPlan sequential queue; handle phase-result/test-complete; assemble latestReport; testingClientId
src/main/ipc.ts                [modify] server:start-test handler; reports:latest-html handler
src/main/preload.mts           [modify] expose startTest + getLatestReportHtml
src/renderer/global.d.ts       [modify] type startTest + getLatestReportHtml
src/renderer/App.tsx           [modify] suite buttons trigger run; progress; inline real report
docs/two-machine-verification.md [modify] add suite-run flow
tests/unit/controlChannel.test.ts [modify] orchestration tests
```

Phase execution scope (per spec): the client runs only `tcp-upload`,
`tcp-download`, `udp-quality`. `connectivity` and `latency` are skipped this
slice.

---

## Task 1: Add testingClientId to server state

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the field**

In `src/shared/types.ts`, replace the `ServerSessionState` interface with:

```ts
export interface ServerSessionState {
  role: "server";
  clients: ConnectedClient[];
  activePlan?: TestPlan;
  latestReport?: TestReport;
  listening: boolean;
  localAddresses: string[];
  testingClientId?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS (`controlServer.getState()` does not yet set `testingClientId`, but it is optional, so this compiles).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add testingClientId to server session state"
```

---

## Task 2: ControlClient — injectable executor + plan execution

**Files:**
- Modify: `src/main/controlClient.ts`
- Test: `tests/unit/controlChannel.test.ts`

- [ ] **Step 1: Write a failing integration test for client plan execution**

Append to `tests/unit/controlChannel.test.ts` (the `ControlServer` and `ControlClient` imports already exist there; `encode`/`net` too). Add this describe block:

```ts
describe("ControlClient plan execution", () => {
  it("runs runnable phases via the injected executor and reports each result then completes", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const runnableKinds: string[] = [];
    const fakeExec = async (input: { phaseKind: string }) => {
      runnableKinds.push(input.phaseKind);
      return { phaseId: input.phaseKind, throughputMbps: 100, errors: [] };
    };

    const client = new ControlClient({ iperfExec: fakeExec as never, id: "cx", name: "CX" });
    const connected = new Promise<void>((resolve) => {
      client.on("state", (s) => {
        if (s.status === "connected" && s.statusText.includes("等待")) resolve();
      });
    });
    client.connectToAddress("127.0.0.1", port);
    await connected;

    // Collect what the server receives back.
    const phaseResults: string[] = [];
    let completed = false;
    srv.on("phase-result", (clientId: string) => phaseResults.push(clientId));
    const done = new Promise<void>((resolve) => srv.on("test-complete", () => { completed = true; resolve(); }));

    // Server tells this one client to run the quick-check plan.
    const { buildTestPlan } = await import("../../src/main/testPlans");
    const plan = buildTestPlan("quick-check", "separate");
    srv.startPlan(plan, ["cx"]);

    await done;
    expect(completed).toBe(true);
    // quick-check has tcp-upload, tcp-download, udp-quality among its phases.
    expect(runnableKinds).toEqual(["tcp-upload", "tcp-download", "udp-quality"]);
    expect(phaseResults.length).toBe(3);

    client.disconnect();
    await srv.close();
  });
});
```

NOTE: this test depends on `ControlServer.startPlan` and the server emitting
`phase-result`/`test-complete` events, which are implemented in Task 3. It will
not pass until Task 3 is done. That is expected — this task's own check is Step 4
(the client compiles and the simpler unit below passes). Mark this test `.skip`
for now by writing `describe.skip("ControlClient plan execution", ...)`, and
Task 3 Step 6 will remove the `.skip`.

- [ ] **Step 2: Run to confirm the suite still loads**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: existing tests PASS; the new block is skipped.

- [ ] **Step 3: Rewrite controlClient.ts with an injectable executor and plan execution**

Replace the ENTIRE contents of `src/main/controlClient.ts` with:

```ts
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { runIperf } from "./iperfRunner.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type {
  ClientSessionState,
  ConnectedClient,
  DiscoveredServer,
  PhaseMetrics,
  TestPhaseKind,
  TestPlan
} from "../shared/types.js";

export type IperfExecutor = typeof runIperf;

export interface ControlClientOptions {
  iperfExec?: IperfExecutor;
  id?: string;
  name?: string;
}

const RUNNABLE_PHASES: ReadonlySet<TestPhaseKind> = new Set<TestPhaseKind>([
  "tcp-upload",
  "tcp-download",
  "udp-quality"
]);

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";
  private lastResult: PhaseMetrics[] | undefined;
  private socket: net.Socket | undefined;
  private intentionalClose = false;
  private readonly iperfExec: IperfExecutor;
  private readonly identity: ConnectedClient;

  constructor(options: ControlClientOptions = {}) {
    super();
    this.iperfExec = options.iperfExec ?? runIperf;
    this.identity = {
      id: options.id ?? `client-${os.hostname()}-${process.pid}`,
      name: options.name ?? os.hostname(),
      address: listLocalIpv4Addresses()[0] ?? "127.0.0.1",
      status: "connected"
    };
  }

  getState(): ClientSessionState {
    return {
      role: "client",
      discoveredServers: [...this.discoveredServers.values()],
      connectedServer: this.connectedServer,
      status: this.status,
      statusText: this.statusText,
      lastResult: this.lastResult
    };
  }

  upsertDiscoveredServer(server: DiscoveredServer): void {
    this.discoveredServers.set(server.id, server);
    if (this.status === "searching") this.statusText = "已发现服务器";
    this.emit("state", this.getState());
  }

  clearDiscoveredServers(): void {
    this.discoveredServers.clear();
    this.emit("state", this.getState());
  }

  connect(serverId: string): void {
    const server = this.discoveredServers.get(serverId);
    if (!server) {
      this.fail("无法连接，请检查是否在同一网络");
      return;
    }
    this.connectToAddress(server.address, server.port, server);
  }

  connectToAddress(address: string, port: number = CONTROL_PORT, server?: DiscoveredServer): void {
    this.disconnect();
    this.intentionalClose = false;
    this.status = "connecting";
    this.statusText = "正在连接服务器";
    this.connectedServer = server ?? {
      id: `manual-${address}`,
      name: address,
      address,
      port,
      lastSeenAt: Date.now()
    };
    this.emit("state", this.getState());

    const decode = createDecoder();
    const socket = net.connect(port, address);
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      socket.write(encode({ type: "register-client", client: this.identity }));
    });

    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "client-registered") {
          this.status = "connected";
          this.statusText = "已连接，等待服务器开始测试";
          this.emit("state", this.getState());
        } else if (message.type === "start-test") {
          void this.runPlan(message.plan, message.serverAddress);
        }
      }
    });

    let settled = false;
    socket.on("error", (error: Error) => {
      if (settled || this.intentionalClose) return;
      settled = true;
      console.error("control client socket error:", error.message);
      this.fail("连接失败，请检查服务器 IP 与防火墙设置");
    });
    socket.on("close", () => {
      if (settled || this.intentionalClose) return;
      settled = true;
      if (this.status === "connected" || this.status === "testing") {
        this.status = "error";
        this.statusText = "与服务器的连接已断开";
        this.emit("state", this.getState());
      }
    });
  }

  // Manual cross-machine test: one short TCP-upload + one UDP-quality run.
  async runManualTest(): Promise<void> {
    if (this.status === "testing") return;
    const host = this.connectedServer?.address;
    if (!host) {
      this.fail("尚未连接服务器，无法测试");
      return;
    }

    this.status = "testing";
    this.statusText = "正在测试网络质量";
    this.emit("state", this.getState());

    try {
      const tcp = await this.iperfExec({ host, phaseKind: "tcp-upload", durationSeconds: 5 });
      const udp = await this.iperfExec({ host, phaseKind: "udp-quality", durationSeconds: 5, targetBitrateMbps: 10 });
      this.lastResult = [tcp, udp];
      this.status = "connected";
      this.statusText = "测试完成";
    } catch (error: unknown) {
      this.status = "error";
      this.statusText = error instanceof Error ? `测试失败：${error.message}` : "测试失败";
    }
    this.emit("state", this.getState());
  }

  // Server-orchestrated run: execute the plan's runnable phases in order,
  // streaming a phase-result per phase and a final test-complete.
  private async runPlan(plan: TestPlan, serverAddress: string): Promise<void> {
    if (this.status === "testing") return;
    const socket = this.socket;
    if (!socket) return;

    this.status = "testing";
    this.emit("state", this.getState());

    const phases = plan.phases.filter((phase) => RUNNABLE_PHASES.has(phase.kind));
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      this.statusText = `正在测试 ${phase.label} (${index + 1}/${phases.length})`;
      this.emit("state", this.getState());

      let metrics: PhaseMetrics;
      try {
        metrics = await this.iperfExec({
          host: serverAddress,
          phaseKind: phase.kind,
          durationSeconds: phase.durationSeconds,
          targetBitrateMbps: phase.targetBitrateMbps
        });
      } catch (error: unknown) {
        metrics = {
          phaseId: phase.id,
          errors: [error instanceof Error ? error.message : "测试阶段失败"]
        };
      }
      socket.write(encode({ type: "phase-result", clientId: this.identity.id, metrics }));
    }

    socket.write(encode({ type: "test-complete", clientId: this.identity.id }));
    this.status = "connected";
    this.statusText = "测试完成";
    this.emit("state", this.getState());
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.socket?.destroy();
    this.socket = undefined;
  }

  private fail(text: string): void {
    this.status = "error";
    this.statusText = text;
    this.emit("state", this.getState());
  }
}
```

- [ ] **Step 4: Typecheck + run tests**

Run: `npm run build`
Expected: PASS. Note: `src/main/ipc.ts` constructs `new ControlClient()` with no args — still valid (options default to `{}`).

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: existing tests PASS; the orchestration block is still skipped.

- [ ] **Step 5: Commit**

```bash
git add src/main/controlClient.ts tests/unit/controlChannel.test.ts
git commit -m "feat: client runs orchestrated plan with injectable iperf executor"
```

---

## Task 3: ControlServer — sequential dispatch + report assembly

**Files:**
- Modify: `src/main/controlServer.ts`
- Test: `tests/unit/controlChannel.test.ts`

- [ ] **Step 1: Write a failing server-side ordering test**

Append to `tests/unit/controlChannel.test.ts`:

```ts
describe("ControlServer.startPlan orchestration", () => {
  it("dispatches to clients sequentially and assembles a report", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const timeline: string[] = [];
    const makeExec = (tag: string) => async (input: { phaseKind: string }) => {
      timeline.push(`${tag}:start:${input.phaseKind}`);
      await new Promise((r) => setTimeout(r, 20));
      timeline.push(`${tag}:end:${input.phaseKind}`);
      return { phaseId: input.phaseKind, throughputMbps: 50, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };

    const mkClient = (id: string) =>
      new Promise<import("../../src/main/controlClient").ControlClient>(async (resolve) => {
        const { ControlClient } = await import("../../src/main/controlClient");
        const c = new ControlClient({ iperfExec: makeExec(id) as never, id, name: id });
        c.on("state", (s) => {
          if (s.status === "connected" && s.statusText.includes("等待")) resolve(c);
        });
        c.connectToAddress("127.0.0.1", port);
      });

    const a = await mkClient("A");
    const b = await mkClient("B");

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => {
        if (s.latestReport) resolve(s);
      });
    });

    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["A", "B"]);

    const finalState = await reported;

    // Sequential: every A event precedes every B event.
    const firstB = timeline.findIndex((e) => e.startsWith("B:"));
    const lastA = timeline.map((e) => e.startsWith("A:")).lastIndexOf(true);
    expect(firstB).toBeGreaterThan(lastA);

    // Report has both clients, each with 3 iperf phases.
    expect(finalState.latestReport?.results.length).toBe(2);
    for (const r of finalState.latestReport!.results) {
      expect(r.phases.length).toBe(3);
    }
    expect(finalState.latestReport?.summary.rating).toBeDefined();

    a.disconnect();
    b.disconnect();
    await srv.close();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: FAIL — `startPlan` does not dispatch/collect/assemble yet.

- [ ] **Step 3: Rewrite controlServer.ts with orchestration**

Replace the ENTIRE contents of `src/main/controlServer.ts` with:

```ts
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import { buildReportSummary } from "./reportGenerator.js";
import type {
  ClientTestResult,
  ConnectedClient,
  ControlMessage,
  PhaseMetrics,
  ServerSessionState,
  TestPlan,
  TestReport
} from "../shared/types.js";

export class ControlServer extends EventEmitter {
  private activePlan: TestPlan | undefined;
  private latestReport: TestReport | undefined;
  private testingClientId: string | undefined;
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly sockets = new Map<string, net.Socket>();
  private netServer: net.Server | undefined;
  private listening = false;
  private localAddresses: string[] = [];

  // Orchestration run state.
  private queue: string[] = [];
  private readonly results = new Map<string, PhaseMetrics[]>();

  getState(): ServerSessionState {
    return {
      role: "server",
      clients: [...this.clients.values()],
      activePlan: this.activePlan,
      latestReport: this.latestReport,
      listening: this.listening,
      localAddresses: this.localAddresses,
      testingClientId: this.testingClientId
    };
  }

  getLatestReport(): TestReport | undefined {
    return this.latestReport;
  }

  listen(port: number = CONTROL_PORT): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.netServer) {
        reject(new Error("Already listening"));
        return;
      }
      const netServer = net.createServer((socket) => this.handleConnection(socket));
      netServer.on("error", reject);
      netServer.listen(port, () => {
        this.netServer = netServer;
        this.listening = true;
        this.localAddresses = listLocalIpv4Addresses();
        const address = netServer.address();
        const boundPort = typeof address === "object" && address ? address.port : port;
        this.emit("state", this.getState());
        resolve(boundPort);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.sockets.values()) socket.destroy();
      this.sockets.clear();
      this.listening = false;
      this.queue = [];
      this.testingClientId = undefined;

      if (!this.netServer) {
        resolve();
        return;
      }
      this.netServer.close(() => {
        this.netServer = undefined;
        this.emit("state", this.getState());
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    const decode = createDecoder();
    let clientId: string | undefined;

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "register-client") {
          clientId = message.client.id;
          this.sockets.set(clientId, socket);
          this.registerClient(message.client);
          socket.write(encode({ type: "client-registered", clientId }));
        } else if (message.type === "phase-result") {
          this.recordPhaseResult(message.clientId, message.metrics);
        } else if (message.type === "test-complete") {
          this.handleTestComplete(message.clientId);
        }
      }
    });

    let dropped = false;
    const drop = (): void => {
      if (dropped) return;
      dropped = true;
      if (clientId) {
        this.sockets.delete(clientId);
        this.handleClientGone(clientId);
      }
    };
    socket.on("close", drop);
    socket.on("error", drop);
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

  private handleClientGone(clientId: string): void {
    this.markClientDisconnected(clientId);
    // If the client under test vanished, drop it from the run and advance.
    if (this.testingClientId === clientId) {
      this.testingClientId = undefined;
      this.dispatchNext();
    } else {
      this.queue = this.queue.filter((id) => id !== clientId);
    }
  }

  // Begin a sequential run of `plan` over the given client ids (in order).
  startPlan(plan: TestPlan, clientIds: string[]): void {
    this.activePlan = plan;
    this.latestReport = undefined;
    this.results.clear();
    this.queue = clientIds.filter((id) => this.sockets.has(id));
    this.emit("state", this.getState());
    this.dispatchNext();
  }

  private dispatchNext(): void {
    const nextId = this.queue.shift();
    if (!nextId) {
      this.finalizeRun();
      return;
    }
    const socket = this.sockets.get(nextId);
    if (!socket) {
      this.dispatchNext();
      return;
    }
    const client = this.clients.get(nextId);
    if (client) this.clients.set(nextId, { ...client, status: "testing" });
    this.testingClientId = nextId;
    this.results.set(nextId, []);

    const serverAddress = this.localAddresses[0] ?? "127.0.0.1";
    socket.write(encode({ type: "start-test", plan: this.activePlan as TestPlan, serverAddress }));
    this.emit("state", this.getState());
  }

  private recordPhaseResult(clientId: string, metrics: PhaseMetrics): void {
    const list = this.results.get(clientId);
    if (list) list.push(metrics);
    this.emit("phase-result", clientId);
  }

  private handleTestComplete(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) this.clients.set(clientId, { ...client, status: "connected" });
    if (this.testingClientId === clientId) this.testingClientId = undefined;
    this.emit("test-complete", clientId);
    this.dispatchNext();
  }

  private finalizeRun(): void {
    const plan = this.activePlan;
    if (!plan) return;

    const results: ClientTestResult[] = [...this.results.entries()].map(([clientId, phases]) => ({
      clientId,
      clientName: this.clients.get(clientId)?.name ?? clientId,
      phases
    }));

    const report: TestReport = {
      id: `report-${Date.now()}`,
      createdAt: new Date().toISOString(),
      suiteId: plan.suiteId,
      serverName: os.hostname(),
      serverAddress: this.localAddresses[0] ?? "127.0.0.1",
      clients: [...this.clients.values()],
      results,
      summary: buildReportSummary(results)
    };

    this.latestReport = report;
    this.activePlan = undefined;
    this.testingClientId = undefined;
    this.emit("state", this.getState());
  }

  broadcast(message: ControlMessage): void {
    const line = encode(message);
    for (const socket of this.sockets.values()) socket.write(line);
  }
}
```

- [ ] **Step 4: Run the ordering test**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: the `ControlServer.startPlan orchestration` test PASSES.

- [ ] **Step 5: Un-skip the Task 2 client test**

In `tests/unit/controlChannel.test.ts`, change `describe.skip("ControlClient plan execution"` back to `describe("ControlClient plan execution"`.

- [ ] **Step 6: Run the full control-channel suite**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: all control-channel tests PASS (registration, client connect, broadcast, client plan execution, server orchestration).

Run: `npm test`
Expected: full suite PASS (no regressions).

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/controlServer.ts tests/unit/controlChannel.test.ts
git commit -m "feat: server orchestrates sequential suite run and assembles report"
```

---

## Task 4: IPC — start-test + report HTML

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Add the handlers**

In `src/main/ipc.ts`:

(a) Add `renderReportHtml` to the existing reportGenerator import. Find:
```ts
import { buildReportSummary, renderReportHtml } from "./reportGenerator.js";
```
It already imports both — no change needed if so. If it only imports `buildReportSummary`, add `renderReportHtml`.

(b) Add `buildTestPlan` usage for the run. The file already imports `buildTestPlan` from `./testPlans.js`. Add these two handlers inside `registerIpcHandlers`, next to the other `ipcMain.handle` calls:

```ts
  ipcMain.handle("server:start-test", (_event, suiteId: TestSuiteId) => {
    const connectedIds = server
      .getState()
      .clients.filter((c) => c.status === "connected")
      .map((c) => c.id);
    if (connectedIds.length === 0) return false;
    server.startPlan(buildTestPlan(suiteId, "separate"), connectedIds);
    return true;
  });

  ipcMain.handle("reports:latest-html", () => {
    const report = server.getLatestReport();
    return report ? renderReportHtml(report) : "";
  });
```

- [ ] **Step 2: Typecheck + tests**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: expose start-test and latest-report-html over IPC"
```

---

## Task 5: Preload + renderer types

**Files:**
- Modify: `src/main/preload.mts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Expose the two methods in preload**

In `src/main/preload.mts`, add these two entries to the `exposeInMainWorld("networkTool", { ... })` object (next to the existing methods):

```ts
  startTest: (suiteId: TestSuiteId) => ipcRenderer.invoke("server:start-test", suiteId) as Promise<boolean>,
  getLatestReportHtml: () => ipcRenderer.invoke("reports:latest-html") as Promise<string>,
```

`TestSuiteId` is already imported in preload.mts.

- [ ] **Step 2: Type them in global.d.ts**

In `src/renderer/global.d.ts`, add to the `networkTool` interface:

```ts
      startTest(suiteId: TestSuiteId): Promise<boolean>;
      getLatestReportHtml(): Promise<string>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.mts src/renderer/global.d.ts
git commit -m "feat: expose startTest and report html to renderer"
```

---

## Task 6: Renderer — trigger run, show progress, render real report

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Wire the server screen**

In `src/renderer/App.tsx`, replace the entire `ServerScreen` function with:

```tsx
function ServerScreen({ suites, onBack }: { suites: SuiteView[]; onBack: () => void }) {
  const [state, setState] = useState<ServerSessionState | undefined>(undefined);
  const [reportHtml, setReportHtml] = useState<string>("");

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getServerState().then(setState);
    return window.networkTool.onServerState(setState);
  }, []);

  // When a real report becomes available, fetch its rendered HTML once.
  const reportId = state?.latestReport?.id;
  useEffect(() => {
    if (!window.networkTool || !reportId) return;
    void window.networkTool.getLatestReportHtml().then(setReportHtml);
  }, [reportId]);

  const testing = Boolean(state?.activePlan);
  const hasClients = (state?.clients.filter((c) => c.status !== "disconnected").length ?? 0) > 0;

  async function startTest(suiteId: TestSuiteId) {
    const started = await window.networkTool.startTest(suiteId);
    if (!started) {
      // eslint-disable-next-line no-alert
      alert("暂无客户端连接，无法开始测试");
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>服务器模式</h1>
          <p>请把下面的 IP 告诉客户端电脑，或等待自动发现。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>本机地址</h2>
          {state && state.localAddresses.length > 0 ? (
            <ul className="address-list">
              {state.localAddresses.map((address) => (
                <li key={address}>{address}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">未检测到本地网络地址</p>
          )}
          <h2>已连接客户端</h2>
          {state && state.clients.length > 0 ? (
            <ul className="client-list">
              {state.clients.map((c) => (
                <li key={c.id}>
                  {c.name}（{c.address}）— {CLIENT_STATUS_LABELS[c.status]}
                  {state.testingClientId === c.id ? " · 测试中" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无客户端连接</p>
          )}
        </div>
        <div className="panel">
          <h2>测试套件</h2>
          {testing ? <p className="empty">测试进行中…</p> : null}
          <div className="suite-list">
            {suites.map((suite) => (
              <button
                key={suite.id}
                type="button"
                className="suite-button"
                disabled={testing || !hasClients}
                onClick={() => void startTest(suite.id)}
              >
                <strong>{suite.label}</strong>
                <span>{suite.description}</span>
              </button>
            ))}
          </div>
          {reportHtml ? (
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : null}
        </div>
      </section>
    </main>
  );
}
```

This removes the sample 预览报告 button — the inline report now comes from a real
run. `CLIENT_STATUS_LABELS` and `SuiteView` already exist in this file.

- [ ] **Step 2: Build + e2e**

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: PASS (2 tests). The electron smoke test clicks 作为服务器 and asserts
suites render — the suite buttons still render (now disabled until a client
connects), so the visibility assertion still holds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: server screen triggers suite run and shows real report"
```

---

## Task 7: Verification doc + full verification

**Files:**
- Modify: `docs/two-machine-verification.md`

- [ ] **Step 1: Add the suite-run flow to the doc**

In `docs/two-machine-verification.md`, after the existing "## Steps" list, add:

```md
## Suite run (server-orchestrated)

7. **Server:** with at least one client connected, click a suite (e.g. 快速检测).
   - Expect: connected clients show "· 测试中" in turn (sequential, one at a time).
   - Expect: each client's status text cycles through 正在测试 TCP 上行/下行/UDP …
8. **Server:** when all clients finish, a report renders inline under 测试套件
   with the rating, per-client table, and the three iperf phases
   (tcp-upload, tcp-download, udp-quality) per client.

Note: connectivity and latency phases are not measured in this version; the
report covers the three iperf throughput/loss/jitter phases.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: all unit tests pass (controlProtocol, controlChannel incl. orchestration, iperfServer, discovery, iperfParser, reportGenerator, testPlans).

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: 2 pass.

- [ ] **Step 3: Commit**

```bash
git add docs/two-machine-verification.md
git commit -m "docs: document server-orchestrated suite run"
```

---

## Self-Review Checklist

- **Spec coverage:** server-triggered run (Task 4 `server:start-test`), sequential dispatch (Task 3 `startPlan`/`dispatchNext`/`handleTestComplete`), client phase execution of the three runnable phases skipping connectivity/latency (Task 2 `runPlan` + `RUNNABLE_PHASES`), result streaming (`phase-result`/`test-complete`), report assembly (Task 3 `finalizeRun` + `buildReportSummary`), inline real report via `reports:latest-html` (Tasks 4–6), injectable executor for tests (Task 2 constructor), `testingClientId` state (Task 1), mid-test disconnect handling (Task 3 `handleClientGone`), no-client guard (Task 4 returns false + Task 6 alert), docs (Task 7).
- **Out of scope honored:** latency/connectivity measurement skipped (documented), no concurrent multi-client, no report export, no signing.
- **Type consistency:** `ControlClientOptions`/`IperfExecutor` (Task 2) used in tests (Tasks 2–3). `startPlan(plan, clientIds)`, `getLatestReport()`, `testingClientId` consistent across controlServer (Task 3), ipc (Task 4), state (Task 1), App (Task 6). `startTest`/`getLatestReportHtml` names match across preload/global.d.ts/App (Tasks 5–6). `ControlMessage` variants (`start-test`/`phase-result`/`test-complete`) already exist in shared types.
- **Placeholder scan:** none.
