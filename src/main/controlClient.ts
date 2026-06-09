import { EventEmitter } from "node:events";
import type { ClientSessionState, DiscoveredServer } from "../shared/types.js";

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
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
