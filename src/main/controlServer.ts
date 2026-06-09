import { EventEmitter } from "node:events";
import net from "node:net";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type { ConnectedClient, ControlMessage, ServerSessionState, TestPlan } from "../shared/types.js";

export class ControlServer extends EventEmitter {
  private activePlan: TestPlan | undefined;
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly sockets = new Map<string, net.Socket>();
  private netServer: net.Server | undefined;
  private listening = false;
  private localAddresses: string[] = [];

  getState(): ServerSessionState {
    return {
      role: "server",
      clients: [...this.clients.values()],
      activePlan: this.activePlan,
      listening: this.listening,
      localAddresses: this.localAddresses
    };
  }

  // Resolves with the actual bound port (useful when passing 0 in tests).
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
        }
      }
    });

    let dropped = false;
    const drop = (): void => {
      if (dropped) return;
      dropped = true;
      if (clientId) {
        this.markClientDisconnected(clientId);
        this.sockets.delete(clientId);
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

  broadcast(message: ControlMessage): void {
    const line = encode(message);
    for (const socket of this.sockets.values()) socket.write(line);
  }
}
