import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { runIperf, type IntervalUpdate } from "./iperfRunner.js";
import { appendLog, stamp } from "./logBuffer.js";
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

const PHASE_LABELS: Record<TestPhaseKind, string> = {
  connectivity: "连通性",
  latency: "延迟",
  "tcp-upload": "TCP 上行",
  "tcp-download": "TCP 下行",
  "udp-quality": "UDP"
};

function formatInterval(update: IntervalUpdate): string {
  const base = `${PHASE_LABELS[update.phaseKind]} ${update.second}s: ${update.throughputMbps.toFixed(1)} Mbps`;
  if (update.udpLossPercent !== undefined || update.jitterMs !== undefined) {
    return `${base} 丢包 ${(update.udpLossPercent ?? 0).toFixed(1)}% 抖动 ${(update.jitterMs ?? 0).toFixed(2)}ms`;
  }
  return base;
}

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";
  private lastResult: PhaseMetrics[] | undefined;
  private log: string[] = [];
  private currentSuite: ClientSessionState["currentSuite"];
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
      lastResult: this.lastResult,
      log: this.log,
      currentSuite: this.currentSuite
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
          this.currentSuite = { label: message.plan.label, status: "running" };
          this.pushLog(`收到测试计划：${message.plan.label}`);
          void this.runPlan(message.plan, message.serverAddress);
        } else if (message.type === "suite-complete") {
          this.currentSuite = { label: this.currentSuite?.label ?? "", status: message.rating };
          this.pushLog(`套件完成，评级：${message.rating}`);
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
    this.pushLog("开始手动测试");

    try {
      const onInterval = (u: IntervalUpdate): void => this.pushLog(formatInterval(u));
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
  }

  // Server-orchestrated run: execute the plan's runnable phases in order,
  // streaming a phase-result per phase and a final test-complete.
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
          (u: IntervalUpdate) => this.pushLog(formatInterval(u))
        );
        const mbps = metrics.throughputMbps !== undefined ? `${metrics.throughputMbps.toFixed(1)} Mbps` : "—";
        this.pushLog(`完成 ${phase.label}: ${mbps}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "测试阶段失败";
        this.pushLog(`${phase.label} 阶段失败：${message}`);
        metrics = {
          phaseId: phase.id,
          errors: [message]
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

  private pushLog(line: string): void {
    this.log = appendLog(this.log, stamp(line));
    if (this.socket && !this.intentionalClose) {
      this.socket.write(encode({ type: "log", clientId: this.identity.id, line }));
    }
    this.emit("state", this.getState());
  }

  private fail(text: string): void {
    this.status = "error";
    this.statusText = text;
    this.emit("state", this.getState());
  }
}
