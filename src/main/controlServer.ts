import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { summarizeStability } from "../shared/stability.js";
import { finalizePhase } from "../shared/measurements.js";
import { randomUUID } from "node:crypto";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { appendLog, stamp } from "./logBuffer.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import { buildReportSummary } from "./reportGenerator.js";
import type {
  ClientTestResult,
  ConnectedClient,
  ControlMessage,
  PhaseMetrics,
  ThroughputSample,
  LiveProgress,
  SuiteStatus,
  ServerSessionState,
  TestPlan,
  TestReport,
  TestSuiteId
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

  private queue: string[] = [];
  private readonly results = new Map<string, PhaseMetrics[]>();
  private runTimer: NodeJS.Timeout | undefined;
  private logLines: string[] = [];
  private suiteStatuses: Partial<Record<TestSuiteId, SuiteStatus>> = {};
  private runId: string | undefined;
  private readonly connections = new Set<net.Socket>();
  private selectedIds: string[] = [];
  private liveProgress: LiveProgress | undefined;
  private readonly phaseIntervals = new Map<string, ThroughputSample[]>();
  private readonly runAddresses = new Map<string, string>();

  getState(): ServerSessionState {
    return {
      role: "server",
      liveProgress: this.liveProgress,
      clients: [...this.clients.values()],
      activePlan: this.activePlan,
      latestReport: this.latestReport,
      listening: this.listening,
      localAddresses: this.localAddresses,
      testingClientId: this.testingClientId,
      log: this.logLines,
      suiteStatuses: this.suiteStatuses
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
      this.netServer = netServer;
      netServer.on("error", error => {
        if (this.netServer === netServer) { this.netServer = undefined; this.listening = false; }
        reject(error);
      });
      netServer.listen(port, "0.0.0.0", () => {
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
      this.activePlan = undefined;
      this.liveProgress = undefined;
      this.runId = undefined;
      for (const socket of this.connections) socket.destroy();
      this.connections.clear();
      this.sockets.clear();
      for (const [id, client] of this.clients) this.clients.set(id, { ...client, status: "disconnected" });
      this.listening = false;
      this.queue = [];
      this.testingClientId = undefined;
      this.clearRunTimer();

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
    this.connections.add(socket);
    const decode = createDecoder();
    let clientId: string | undefined;

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "register-client") {
          if (clientId || this.sockets.has(message.client.id)) { socket.destroy(); return; }
          clientId = message.client.id;
          this.sockets.set(clientId, socket);
          this.registerClient({ ...message.client, address: socket.remoteAddress?.replace(/^::ffff:/, "") ?? message.client.address });
          socket.write(encode({ type: "client-registered", clientId }));
        } else if (!clientId || !("clientId" in message) || message.clientId !== clientId) {
          continue;
        } else if (message.type === "phase-progress" && message.runId === this.runId) {
          this.recordProgress(message.clientId, message.phaseId, message.interval);
        } else if (message.type === "phase-result" && message.runId === this.runId) {
          this.recordPhaseResult(message.clientId, message.metrics);
        } else if (message.type === "test-busy" && message.runId === this.runId && this.testingClientId === clientId) {
          this.notifyNetworkError(`客户端忙碌，未执行本轮计划：${clientId}`);
          this.handleTestComplete(clientId);
        } else if (message.type === "test-complete" && message.runId === this.runId) {
          this.handleTestComplete(message.clientId);
        } else if (message.type === "log") {
          const name = this.clients.get(message.clientId)?.name ?? message.clientId;
          this.pushLog(`${name} ${message.line}`);
        }
      }
    });

    let dropped = false;
    const drop = (): void => {
      if (dropped) return;
      dropped = true;
      this.connections.delete(socket);
      if (clientId && this.sockets.get(clientId) === socket) {
        this.sockets.delete(clientId);
        this.handleClientGone(clientId);
      }
    };
    socket.on("close", drop);
    socket.on("error", drop);
  }

  registerClient(client: ConnectedClient): void {
    this.clients.set(client.id, { ...client, status: "connected" });
    this.pushLog(`客户端已连接：${client.name}`);
  }

  markClientDisconnected(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.set(clientId, { ...client, status: "disconnected" });
    this.emit("state", this.getState());
  }

  private handleClientGone(clientId: string): void {
    this.markClientDisconnected(clientId);
    this.pushLog(`客户端断开：${this.clients.get(clientId)?.name ?? clientId}`);
    if (this.testingClientId === clientId) {
      this.testingClientId = undefined;
      this.clearRunTimer();
      if (this.activePlan) this.dispatchNext();
    } else {
      this.queue = this.queue.filter((id) => id !== clientId);
    }
  }

  startPlan(plan: TestPlan, clientIds: string[]): void {
    if (this.activePlan) {
      console.warn("control server: startPlan ignored, a run is already in progress");
      return;
    }
    this.activePlan = plan;
    this.runId = randomUUID();
    this.latestReport = undefined;
    this.results.clear();
    this.phaseIntervals.clear();
    this.liveProgress = undefined;
    this.runAddresses.clear();
    this.selectedIds = [...new Set(clientIds)];
    this.queue = this.selectedIds.filter((id) => this.sockets.has(id));
    for (const id of this.selectedIds) this.results.set(id, []);
    this.emit("state", this.getState());
    this.dispatchNext();
  }

  private dispatchNext(): void {
    for (;;) {
      const nextId = this.queue.shift();
      if (!nextId) {
        this.finalizeRun();
        return;
      }
      const socket = this.sockets.get(nextId);
      if (!socket) continue; // client gone before its turn; skip

      const client = this.clients.get(nextId);
      if (client) this.clients.set(nextId, { ...client, status: "testing" });
      this.testingClientId = nextId;
      this.liveProgress = undefined;
      this.pushLog(`派发测试给 ${client?.name ?? nextId}`);
      this.results.set(nextId, []);

      const serverAddress = socket.localAddress?.replace(/^::ffff:/, "") ?? "127.0.0.1";
      this.runAddresses.set(nextId, serverAddress);
      socket.write(encode({ type: "start-test", runId: this.runId!, plan: this.activePlan as TestPlan, serverAddress }));
      this.startRunTimer(nextId);
      return;
    }
  }

  private recordProgress(clientId: string, phaseId: string, interval: ThroughputSample): void {
    if (this.testingClientId !== clientId || !this.activePlan?.phases.some(p => p.id === phaseId)
      || this.results.get(clientId)?.some(p => p.phaseId === phaseId)) return;
    const key = JSON.stringify([clientId, phaseId]);
    const intervals = this.phaseIntervals.get(key) ?? [];
    const last = intervals[intervals.length - 1];
    if (intervals.length >= 86400 || (last && (interval.startSeconds < last.endSeconds - .001 || interval.side !== last.side))) return;
    intervals.push(interval);
    this.phaseIntervals.set(key, intervals);
    this.liveProgress = { phaseId, intervals: intervals.slice(-120) };
    this.emit("state", this.getState());
  }

  private recordPhaseResult(clientId: string, metrics: PhaseMetrics): void {
    if (this.testingClientId !== clientId || !this.activePlan?.phases.some(p => p.id === metrics.phaseId)) return;
    const intervals = this.phaseIntervals.get(JSON.stringify([clientId, metrics.phaseId]));
    metrics = { ...metrics, intervals, throughputSeriesSide: intervals?.[0]?.side, stability: summarizeStability(intervals ?? [], metrics.durationSeconds) };
    const list = this.results.get(clientId);
    if (list && !list.some(p => p.phaseId === metrics.phaseId)) this.results.set(clientId, [...list, metrics]);
    this.emit("phase-result", clientId);
  }

  private handleTestComplete(clientId: string): void {
    if (this.testingClientId !== clientId) return;
    const client = this.clients.get(clientId);
    this.pushLog(`${client?.name ?? clientId} 测试完成`);
    if (client) this.clients.set(clientId, { ...client, status: "connected" });
    this.emit("test-complete", clientId);
    if (this.testingClientId !== clientId) return; // stale/unknown completion: ignore
    this.testingClientId = undefined;
    this.clearRunTimer();
    this.dispatchNext();
  }

  private finalizeRun(): void {
    this.clearRunTimer();
    const plan = this.activePlan;
    if (!plan) return;

    if (this.results.size === 0) {
      this.activePlan = undefined;
      this.testingClientId = undefined;
      this.emit("state", this.getState());
      return;
    }

    const results: ClientTestResult[] = [...this.results.entries()].map(([clientId, phases]) => ({
      clientId,
      clientName: this.clients.get(clientId)?.name ?? clientId,
      serverAddress: this.runAddresses.get(clientId),
      phases: plan.phases.map(phase => {
        const measured = phases.find(p => p.phaseId === phase.id);
        if (measured) return finalizePhase(phase, measured);
        const intervals = this.phaseIntervals.get(JSON.stringify([clientId, phase.id]));
        return { ...finalizePhase(phase), intervals, throughputSeriesSide: intervals?.[0]?.side, stability: summarizeStability(intervals ?? []) };
      })
    }));

    const report: TestReport = {
      id: `report-${Date.now()}`,
      createdAt: new Date().toISOString(),
      suiteId: plan.suiteId,
      serverName: os.hostname(),
      serverAddress: [...new Set(this.runAddresses.values())].join(", ") || "未开始测试",
      results,
      summary: buildReportSummary(results),
      plan,
      clients: this.selectedIds.map(id => this.clients.get(id)).filter((c): c is ConnectedClient => Boolean(c))
    };

    this.latestReport = report;
    this.liveProgress = undefined;
    const status: SuiteStatus = report.summary.incompletePhases ? "incomplete" : "completed";
    this.suiteStatuses = { ...this.suiteStatuses, [plan.suiteId]: status };
    this.pushLog(`报告就绪：${report.summary.completedPhases}/${report.summary.totalPhases} 阶段完成`);
    for (const id of this.selectedIds) this.sockets.get(id)?.write(encode({ type: "suite-complete", suiteId: plan.suiteId, status }));
    this.activePlan = undefined;
    this.testingClientId = undefined;
    this.emit("state", this.getState());
  }

  private startRunTimer(clientId: string): void {
    this.clearRunTimer();
    const plan = this.activePlan;
    const totalSeconds = plan ? plan.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0) : 0;
    const timeoutMs = totalSeconds * 1000 + (plan?.phases.length ?? 0) * 15_000 + 30_000; // generous grace beyond the planned duration
    this.runTimer = setTimeout(() => this.handleRunTimeout(clientId), timeoutMs);
    // Do not keep the process alive solely for this timer.
    this.runTimer.unref?.();
  }

  private clearRunTimer(): void {
    if (this.runTimer) clearTimeout(this.runTimer);
    this.runTimer = undefined;
  }

  private handleRunTimeout(clientId: string): void {
    if (this.testingClientId !== clientId) return;
    console.warn(`control server: client ${clientId} timed out; skipping`);
    const client = this.clients.get(clientId);
    if (client) this.clients.set(clientId, { ...client, status: "connected" });
    if (this.runId) this.sockets.get(clientId)?.write(encode({ type: "cancel-test", runId: this.runId }));
    this.testingClientId = undefined;
    this.dispatchNext(); // keeps whatever partial phase-results were collected
  }

  notifyNetworkError(message: string): void { this.pushLog(message); }

  private pushLog(line: string): void {
    this.logLines = appendLog(this.logLines, stamp(line));
    this.emit("state", this.getState());
  }

  broadcast(message: ControlMessage): void {
    const line = encode(message);
    for (const socket of this.sockets.values()) socket.write(line);
  }
}
