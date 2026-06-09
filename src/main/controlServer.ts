import { EventEmitter } from "node:events";
import type { ConnectedClient, ServerSessionState, TestPlan } from "../shared/types.js";

export class ControlServer extends EventEmitter {
  private activePlan: TestPlan | undefined;
  private readonly clients = new Map<string, ConnectedClient>();

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
