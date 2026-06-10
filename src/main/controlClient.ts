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
    this.statusText = "正在准备测试";
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
