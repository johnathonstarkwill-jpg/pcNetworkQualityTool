import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { runIperf } from "./iperfRunner.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type { ClientSessionState, ConnectedClient, DiscoveredServer, PhaseMetrics } from "../shared/types.js";

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";
  private lastResult: PhaseMetrics[] | undefined;
  private socket: net.Socket | undefined;
  private readonly identity: ConnectedClient = {
    id: `client-${os.hostname()}-${process.pid}`,
    name: os.hostname(),
    address: listLocalIpv4Addresses()[0] ?? "127.0.0.1",
    status: "connected"
  };

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
        }
      }
    });

    socket.on("error", () => this.fail("连接失败，请检查服务器 IP 与防火墙设置"));
    socket.on("close", () => {
      if (this.status === "connected") {
        this.status = "error";
        this.statusText = "与服务器的连接已断开";
        this.emit("state", this.getState());
      }
    });
  }

  // Manual cross-machine test: one short TCP-upload + one UDP-quality run
  // against the connected server. Returns nothing; results land in state.
  async runManualTest(): Promise<void> {
    const host = this.connectedServer?.address;
    if (!host) {
      this.fail("尚未连接服务器，无法测试");
      return;
    }

    this.status = "testing";
    this.statusText = "正在测试网络质量";
    this.emit("state", this.getState());

    try {
      const tcp = await runIperf({ host, phaseKind: "tcp-upload", durationSeconds: 5 });
      const udp = await runIperf({ host, phaseKind: "udp-quality", durationSeconds: 5, targetBitrateMbps: 10 });
      this.lastResult = [tcp, udp];
      this.status = "connected";
      this.statusText = "测试完成";
    } catch (error: unknown) {
      this.status = "error";
      this.statusText = error instanceof Error ? `测试失败：${error.message}` : "测试失败";
    }
    this.emit("state", this.getState());
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private fail(text: string): void {
    this.status = "error";
    this.statusText = text;
    this.emit("state", this.getState());
  }
}
