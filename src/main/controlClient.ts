import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { runWithLoadedLatency } from "./loadedLatency.js";
import { finalizePhase } from "../shared/measurements.js";
import { runNetworkProbe } from "./networkProbe.js";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { runIperf, type IntervalUpdate } from "./iperfRunner.js";
import { appendLog, stamp } from "./logBuffer.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type {
  ClientSessionState,
  ConnectedClient,
  DiscoveredServer,
  PhaseMetrics,
  LiveProgress,
  TestPhaseKind,
  TestPlan
} from "../shared/types.js";

export type IperfExecutor = typeof runIperf;

export interface ControlClientOptions {
  iperfExec?: IperfExecutor;
  probeExec?: typeof runNetworkProbe;
  id?: string;
  name?: string;
}

const PHASE_LABELS: Record<TestPhaseKind, string> = {
  connectivity: "连通性",
  latency: "延迟",
  "tcp-upload": "TCP 上行",
  "tcp-download": "TCP 下行",
  "udp-quality": "UDP 上行",
  "udp-download": "UDP 下行"
};

function formatInterval(update: IntervalUpdate): string {
  const side = (update.phaseKind === "tcp-download" || update.phaseKind === "udp-download") ? "接收" : "发送";
  const fields = [`${PHASE_LABELS[update.phaseKind]} ${update.second}s: 实时${side}速率 ${update.throughputMbps.toFixed(3)} Mbps`];
  if (update.udpLossPercent !== undefined) fields.push(`丢包 ${update.udpLossPercent.toFixed(3)}%`);
  if (update.jitterMs !== undefined) fields.push(`UDP 抖动 ${update.jitterMs.toFixed(3)} ms`);
  return fields.join(" ");
}

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";
  private lastResult: PhaseMetrics[] | undefined;
  private liveProgress: LiveProgress | undefined;
  private log: string[] = [];
  private currentSuite: ClientSessionState["currentSuite"];
  private socket: net.Socket | undefined;
  private intentionalClose = false;
  private runAbort: AbortController | undefined;
  private runningId: string | undefined;
  private readonly probeExec: typeof runNetworkProbe;
  private readonly iperfExec: IperfExecutor;
  private readonly identity: ConnectedClient;

  constructor(options: ControlClientOptions = {}) {
    super();
    this.iperfExec = options.iperfExec ?? runIperf;
    this.probeExec = options.probeExec ?? runNetworkProbe;
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
      liveProgress: this.liveProgress,
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
    address = address.trim();
    if (net.isIP(address) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.fail("请输入有效的服务器 IPv4 地址");
      return;
    }
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
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error("连接或注册超时"));
    });

    socket.on("connect", () => {
      socket.write(encode({ type: "register-client", client: this.identity }));
    });

    socket.on("data", (chunk: string) => {
      if (this.socket !== socket) return;
      for (const message of decode(chunk)) {
        if (message.type === "client-registered" && message.clientId === this.identity.id) {
          socket.setTimeout(0);
          this.status = "connected";
          this.statusText = "已连接，等待服务器开始测试";
          this.emit("state", this.getState());
        } else if (message.type === "start-test") {
          this.currentSuite = { label: message.plan.label, status: "running" };
          this.pushLog(`收到测试计划：${message.plan.label}`);
          void this.runPlan(message.plan, this.connectedServer!.address, message.runId);
        } else if (message.type === "cancel-test" && message.runId === this.runningId) {
          this.runAbort?.abort();
          this.status = "connected";
          this.statusText = "测试已取消";
          this.pushLog(this.statusText);
        } else if (message.type === "suite-complete") {
          this.currentSuite = { label: this.currentSuite?.label ?? "", status: message.status };
          this.pushLog(message.status === "completed" ? "套件数据采集完成" : "套件存在未完成阶段");
        }
      }
    });

    let settled = false;
    socket.on("error", (error: Error) => {
      if (settled || this.intentionalClose || this.socket !== socket) return;
      settled = true;
      this.runAbort?.abort();
      console.error("control client socket error:", error.message);
      this.fail("连接失败，请检查服务器 IP 与防火墙设置");
    });
    socket.on("close", () => {
      if (settled || this.intentionalClose || this.socket !== socket) return;
      settled = true;
      this.runAbort?.abort();
      if (this.status === "connected" || this.status === "testing" || this.status === "connecting") {
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
    if (!host || this.status !== "connected") {
      this.fail("尚未连接服务器，无法测试");
      return;
    }

    const abort = new AbortController();
    this.runAbort = abort;
    this.status = "testing";
    this.statusText = "正在测试网络质量";
    this.pushLog("开始手动测试");

    this.lastResult = [];
    for (const kind of ["connectivity", "latency", "tcp-upload", "tcp-download", "udp-quality", "udp-download"] as const) {
      if (abort.signal.aborted) return;
      const phase = { id: kind, kind, label: PHASE_LABELS[kind], durationSeconds: 5, ...((kind === "udp-quality" || kind === "udp-download") ? { targetBitrateMbps: 10 } : {}) };
      let metrics: PhaseMetrics;
      this.liveProgress = undefined;
      this.statusText = `正在测试 ${phase.label}`;
      this.pushLog(this.statusText);
      try {
        metrics = kind === "connectivity" || kind === "latency"
          ? await this.probeExec({ host, phaseKind: kind, durationSeconds: 5, port: this.connectedServer?.port, signal: abort.signal })
          : await runWithLoadedLatency({ host, phaseKind: kind, durationSeconds: 5, targetBitrateMbps: phase.targetBitrateMbps, signal: abort.signal }, this.lastResult?.find(p => p.phaseId === "latency"), this.iperfExec, this.probeExec, u => this.recordProgress(phase.id, u));
      } catch (error) { metrics = { phaseId: kind, errors: [error instanceof Error ? error.message : "采集失败"] }; }
      if (abort.signal.aborted) return;
      this.lastResult = [...(this.lastResult ?? []), finalizePhase(phase, metrics)];
      this.emit("state", this.getState());
    }
    this.status = "connected";
    this.liveProgress = undefined;
    this.statusText = "手动测试数据采集结束";
    this.pushLog(this.statusText);
  }

  // Server-orchestrated run: execute every planned phase in order,
  // streaming a phase-result per phase and a final test-complete.
  private async runPlan(plan: TestPlan, serverAddress: string, runId: string): Promise<void> {
    if (this.status === "testing") {
      this.socket?.write(encode({ type: "test-busy", runId, clientId: this.identity.id }));
      return;
    }
    const socket = this.socket;
    if (!socket) return;

    this.status = "testing";
    const abort = new AbortController();
    this.runAbort = abort;
    this.runningId = runId;
    const collected: PhaseMetrics[] = [];
    this.lastResult = undefined;
    this.statusText = "正在准备测试";
    this.emit("state", this.getState());

    const phases = plan.phases;
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      this.liveProgress = undefined;
      this.statusText = `正在测试 ${phase.label} (${index + 1}/${phases.length})`;
      this.pushLog(`开始 ${phase.label}`);

      let metrics: PhaseMetrics;
      try {
        metrics = phase.kind === "connectivity" || phase.kind === "latency"
          ? await this.probeExec({ host: serverAddress, phaseKind: phase.kind, durationSeconds: phase.durationSeconds, port: this.connectedServer?.port, signal: abort.signal })
          : await runWithLoadedLatency(
          {
            host: serverAddress,
            phaseKind: phase.kind,
            durationSeconds: phase.durationSeconds,
            targetBitrateMbps: phase.targetBitrateMbps,
            signal: abort.signal
          },
          collected.find(p => p.phaseId === "latency"), this.iperfExec, this.probeExec,
          (u: IntervalUpdate) => {
            if (abort.signal.aborted || this.socket !== socket) return;
            const interval = this.recordProgress(phase.id, u);
            socket.write(encode({ type: "phase-progress", runId, clientId: this.identity.id, phaseId: phase.id, interval }));
          }
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
      if (abort.signal.aborted || this.socket !== socket) return;
      metrics = finalizePhase(phase, metrics);
      collected.push(metrics);
      this.lastResult = [...collected];
      // Raw samples have already streamed individually; keep the final frame bounded.
      socket.write(encode({ type: "phase-result", runId, clientId: this.identity.id, metrics: { ...metrics, intervals: undefined } }));
    }

    socket.write(encode({ type: "test-complete", runId, clientId: this.identity.id }));
    this.status = "connected";
    this.liveProgress = undefined;
    this.statusText = "测试完成";
    this.emit("state", this.getState());
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.runAbort?.abort();
    this.runAbort = undefined;
    this.runningId = undefined;
    this.status = "searching";
    this.statusText = "正在搜索服务器";
    this.connectedServer = undefined;
    this.currentSuite = undefined;
    this.lastResult = undefined;
    this.liveProgress = undefined;
    this.socket?.destroy();
    this.socket = undefined;
  }

  private recordProgress(phaseId: string, update: IntervalUpdate) {
    const interval = { startSeconds: update.startSeconds ?? Math.max(0, update.second - 1), endSeconds: update.endSeconds ?? update.second,
      mbps: update.throughputMbps, side: update.side ?? (update.phaseKind.endsWith("download") ? "receiver" as const : "sender" as const) };
    const previous = this.liveProgress?.phaseId === phaseId ? this.liveProgress.intervals : [];
    this.liveProgress = { phaseId, intervals: [...previous.slice(-119), interval] };
    this.pushLog(formatInterval(update));
    return interval;
  }

  private pushLog(line: string): void {
    this.log = appendLog(this.log, stamp(line));
    if (this.socket && !this.intentionalClose) {
      this.socket.write(encode({ type: "log", clientId: this.identity.id, line }));
    }
    this.emit("state", this.getState());
  }

  notifyDiscoveryError(message: string): void {
    this.statusText = `自动搜索不可用：${message}；请使用手动 IP 连接`;
    this.pushLog(this.statusText);
  }

  private fail(text: string): void {
    this.status = "error";
    this.statusText = text;
    this.emit("state", this.getState());
  }
}
