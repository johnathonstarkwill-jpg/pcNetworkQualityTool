import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { getDiscoveryInterfaces, type DiscoveryInterface } from "./netInfo.js";
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

export const DISCOVERY_QUERY_PORT = 48102;
const QUERY = Buffer.from(`${DISCOVERY_PREFIX}:DISCOVER`);
type Interfaces = () => DiscoveryInterface[];

// Bind sends to each LAN address instead of letting the VPN/default route choose
// the source interface. Keep failed interfaces independent of working ones.
class InterfaceSockets extends EventEmitter {
  private sockets = new Map<string, { socket: dgram.Socket; iface: DiscoveryInterface; ready: boolean }>();
  private stopped = false;
  private lastErrors = new Map<string, number>();
  constructor(private port: number, private interfaces: Interfaces) { super(); }
  report(error: Error, address: string): void {
    const key = `${address}:${error.message}`;
    const now = Date.now();
    const previous = this.lastErrors.get(key);
    if (previous !== undefined && now - previous < 30_000) return;
    this.lastErrors.set(key, now);
    this.emit("network-error", new Error(`${address}: ${error.message}。请检查本地网络权限、防火墙或 VPN；仍可尝试手动 IP 连接。`));
  }
  refresh(): void {
    if (this.stopped) return;
    const interfaces = this.interfaces();
    for (const [address, item] of this.sockets) {
      if (!interfaces.some(i => i.address === address && i.broadcast === item.iface.broadcast)) {
        this.sockets.delete(address); item.socket.close();
      }
    }
    for (const iface of interfaces) {
      if (this.sockets.has(iface.address)) continue;
      const socket = dgram.createSocket("udp4");
      const item = { socket, iface, ready: false };
      this.sockets.set(iface.address, item);
      socket.on("error", error => {
        if (this.stopped) return;
        this.report(error, iface.address);
        if (!item.ready) { this.sockets.delete(iface.address); socket.close(); }
      });
      socket.on("message", (message, remote) => this.emit("message", message, remote, item));
      socket.bind(this.port, iface.address, () => {
        if (this.stopped || this.sockets.get(iface.address)?.socket !== socket) return;
        socket.setBroadcast(true); item.ready = true; this.emit("ready", item);
      });
    }
  }
  send(item: { socket: dgram.Socket; iface: DiscoveryInterface }, message: Buffer, port: number, address: string): void {
    if (this.stopped || this.sockets.get(item.iface.address)?.socket !== item.socket) return;
    item.socket.send(message, port, address, error => { if (error && !this.stopped) this.report(error, item.iface.address); });
  }
  each(fn: (item: { socket: dgram.Socket; iface: DiscoveryInterface }) => void): void {
    for (const item of this.sockets.values()) if (item.ready) fn(item);
  }
  stop(): void {
    this.stopped = true;
    for (const { socket } of this.sockets.values()) socket.close();
    this.sockets.clear();
  }
}

export class DiscoveryBroadcaster extends EventEmitter {
  private transport: InterfaceSockets;
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly server: Omit<DiscoveredServer, "lastSeenAt">, interfaces: Interfaces = getDiscoveryInterfaces) {
    super();
    this.transport = new InterfaceSockets(DISCOVERY_QUERY_PORT, interfaces);
    this.transport.on("network-error", error => this.emit("network-error", error));
    this.transport.on("ready", item => this.announce(item));
    this.transport.on("message", (message: Buffer, remote: dgram.RemoteInfo, item) => {
      if (message.equals(QUERY)) this.announce(item, remote.port, remote.address);
    });
  }
  start(): void {
    this.transport.refresh();
    this.timer = setInterval(() => { this.transport.refresh(); this.transport.each(item => this.announce(item)); }, 1000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.transport.stop(); }
  private announce(item: { socket: dgram.Socket; iface: DiscoveryInterface }, port = DISCOVERY_PORT, address = item.iface.broadcast): void {
    const message = serializeDiscoveryMessage({ ...this.server, address: item.iface.address, lastSeenAt: Date.now() });
    this.transport.send(item, message, port, address);
  }
}

export class DiscoveryScanner extends EventEmitter {
  private socket = dgram.createSocket("udp4");
  private transport: InterfaceSockets;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  constructor(interfaces: Interfaces = getDiscoveryInterfaces) {
    super();
    this.transport = new InterfaceSockets(0, interfaces);
    this.transport.on("network-error", error => this.emit("network-error", error));
    this.transport.on("ready", item => this.query(item));
    this.transport.on("message", (message, remote) => this.receive(message, remote));
  }
  private receive(message: Buffer, remote: dgram.RemoteInfo): void {
    if (this.stopped) return;
    const server = parseDiscoveryMessage(message);
    if (server) this.emit("server", { ...server, address: remote.address, lastSeenAt: Date.now() });
  }
  private query(item: { socket: dgram.Socket; iface: DiscoveryInterface }): void {
    this.transport.send(item, QUERY, DISCOVERY_QUERY_PORT, item.iface.broadcast);
  }
  start(): void {
    this.socket.on("error", error => this.emit("network-error", error));
    this.socket.on("message", (message, remote) => this.receive(message, remote));
    this.socket.bind(DISCOVERY_PORT, "0.0.0.0");
    this.transport.refresh();
    this.timer = setInterval(() => { this.transport.refresh(); this.transport.each(item => this.query(item)); }, 3000);
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.transport.stop(); this.socket.close();
  }
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
