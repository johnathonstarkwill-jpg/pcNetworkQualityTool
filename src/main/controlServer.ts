import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { appendLog, stamp } from "./logBuffer.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import { buildReportSummary } from "./reportGenerator.js";
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
  private suiteRatings: Partial<Record<TestSuiteId, ReportSummary["rating"]>> = {};

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
      this.dispatchNext();
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
    this.latestReport = undefined;
    this.results.clear();
    this.queue = clientIds.filter((id) => this.sockets.has(id));
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
      this.pushLog(`派发测试给 ${client?.name ?? nextId}`);
      this.results.set(nextId, []);

      const serverAddress = this.localAddresses[0] ?? "127.0.0.1";
      socket.write(encode({ type: "start-test", plan: this.activePlan as TestPlan, serverAddress }));
      this.startRunTimer(nextId);
      return;
    }
  }

  private recordPhaseResult(clientId: string, metrics: PhaseMetrics): void {
    const list = this.results.get(clientId);
    if (list) this.results.set(clientId, [...list, metrics]);
    this.emit("phase-result", clientId);
  }

  private handleTestComplete(clientId: string): void {
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
    this.suiteRatings = { ...this.suiteRatings, [plan.suiteId]: report.summary.rating };
    this.pushLog(`报告就绪：评级 ${report.summary.rating}`);
    this.broadcast({ type: "suite-complete", suiteId: plan.suiteId, rating: report.summary.rating });
    this.activePlan = undefined;
    this.testingClientId = undefined;
    this.emit("state", this.getState());
  }

  private startRunTimer(clientId: string): void {
    this.clearRunTimer();
    const plan = this.activePlan;
    const totalSeconds = plan ? plan.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0) : 0;
    const timeoutMs = totalSeconds * 1000 + 30_000; // generous grace beyond the planned duration
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
    this.testingClientId = undefined;
    this.dispatchNext(); // keeps whatever partial phase-results were collected
  }

  private pushLog(line: string): void {
    this.logLines = appendLog(this.logLines, stamp(line));
    this.emit("state", this.getState());
  }

  broadcast(message: ControlMessage): void {
    const line = encode(message);
    for (const socket of this.sockets.values()) socket.write(line);
  }
}
