import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import os from "node:os";
import type { DiscoveredServer } from "../shared/types.js";

const DISCOVERY_PREFIX = "PC_NETWORK_QUALITY_TOOL_V1";
export const DISCOVERY_PORT = 48101;

export function serializeDiscoveryMessage(server: DiscoveredServer): Buffer {
  return Buffer.from(`${DISCOVERY_PREFIX}:${JSON.stringify(server)}`, "utf8");
}

export function parseDiscoveryMessage(buffer: Buffer): DiscoveredServer | null {
  const text = buffer.toString("utf8");
  if (!text.startsWith(`${DISCOVERY_PREFIX}:`)) return null;

  try {
    const parsed = JSON.parse(text.slice(DISCOVERY_PREFIX.length + 1)) as DiscoveredServer;
    if (!isValidDiscoveredServer(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

export class DiscoveryBroadcaster extends EventEmitter {
  private socket = dgram.createSocket("udp4");
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly server: Omit<DiscoveredServer, "lastSeenAt">) {
    super();
    this.socket.on("error", error => this.emit("network-error", error));
  }

  start(): void {
    this.socket.bind(() => {
      if (this.stopped) return;
      this.socket.setBroadcast(true);
      this.broadcast();
      this.timer = setInterval(() => this.broadcast(), 1000);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.socket.close();
  }

  private broadcast(): void {
    const message = serializeDiscoveryMessage({ ...this.server, lastSeenAt: Date.now() });
    this.socket.send(message, DISCOVERY_PORT, "255.255.255.255", error => {
      if (error) this.emit("network-error", error);
    });
  }
}

export class DiscoveryScanner extends EventEmitter {
  private socket = dgram.createSocket("udp4");

  start(): void {
    this.socket.on("error", error => this.emit("network-error", error));
    this.socket.on("message", (message, remote) => {
      const server = parseDiscoveryMessage(message);
      if (server) this.emit("server", { ...server, address: remote.address, lastSeenAt: Date.now() });
    });

    this.socket.bind(DISCOVERY_PORT);
  }

  stop(): void {
    this.socket.close();
  }
}

export function getLikelyLocalAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(isExternalIpv4Address)
    .map((item) => item.address);
}

function isExternalIpv4Address(item: os.NetworkInterfaceInfo | undefined): item is os.NetworkInterfaceInfo {
  return item !== undefined && item.family === "IPv4" && !item.internal;
}

function isValidDiscoveredServer(value: DiscoveredServer): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.address === "string" &&
    value.address.length > 0 &&
    typeof value.port === "number" &&
    Number.isInteger(value.port) &&
    value.port > 0 && value.port <= 65535 &&
    typeof value.lastSeenAt === "number" &&
    Number.isFinite(value.lastSeenAt)
  );
}
