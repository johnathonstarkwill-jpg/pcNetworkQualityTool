import { describe, expect, it } from "vitest";
import { parseDiscoveryMessage, serializeDiscoveryMessage } from "../../src/main/discovery";

describe("discovery", () => {
  it("round trips a discovery message", () => {
    const raw = serializeDiscoveryMessage({
      id: "server-1",
      name: "测试服务器",
      address: "192.168.1.10",
      port: 48100,
      lastSeenAt: 1000
    });

    expect(parseDiscoveryMessage(raw)).toEqual({
      id: "server-1",
      name: "测试服务器",
      address: "192.168.1.10",
      port: 48100,
      lastSeenAt: 1000
    });
  });

  it("rejects non-tool messages", () => {
    expect(parseDiscoveryMessage(Buffer.from("hello"))).toBeNull();
  });

  it("rejects malformed discovery payloads", () => {
    const malformed = Buffer.from("PC_NETWORK_QUALITY_TOOL_V1:{", "utf8");

    expect(parseDiscoveryMessage(malformed)).toBeNull();
  });
});

it("reports a discovery port conflict without an unhandled socket error", async () => {
  const { DiscoveryScanner, DISCOVERY_PORT } = await import("../../src/main/discovery");
  const dgram = await import("node:dgram");
  const blocker = dgram.createSocket("udp4");
  await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.bind(DISCOVERY_PORT, resolve); });
  const scanner = new DiscoveryScanner(() => []);
  try {
    const error = new Promise<Error>(resolve => scanner.once("network-error", resolve));
    scanner.start();
    expect((await error).message).toContain("EADDRINUSE");
  } finally { scanner.stop(); blocker.close(); }
});

it("discovers via query/reply even when passive announcement port is occupied", async () => {
  const { DiscoveryBroadcaster, DiscoveryScanner, DISCOVERY_PORT } = await import("../../src/main/discovery");
  const dgram = await import("node:dgram");
  const interfaces = () => [{ name: "test", address: "127.0.0.1", broadcast: "127.0.0.1" }];
  const blocker = dgram.createSocket("udp4");
  await new Promise<void>(resolve => blocker.bind(DISCOVERY_PORT, "0.0.0.0", resolve));
  const server = new DiscoveryBroadcaster({ id: "query-server", name: "Query server", address: "192.0.2.1", port: 48200 }, interfaces);
  const scanner = new DiscoveryScanner(interfaces);
  const failures: Error[] = [];
  server.on("network-error", error => failures.push(error));
  scanner.on("network-error", error => failures.push(error));
  try {
    const discovered = new Promise<any>(resolve => scanner.once("server", resolve));
    server.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    scanner.start();
    const found = await discovered;
    expect(found).toMatchObject({ id: "query-server", address: "127.0.0.1", port: 48200 });
    expect(failures.some(e => e.message.includes("EADDRINUSE"))).toBe(true);
  } finally { scanner.stop(); server.stop(); blocker.close(); }
});

it("refreshes network interfaces and stops cleanly before bind completes", async () => {
  const { DiscoveryBroadcaster, DiscoveryScanner } = await import("../../src/main/discovery");
  const interfaces = () => [{ name: "test", address: "127.0.0.1", broadcast: "127.0.0.1" }];
  const server = new DiscoveryBroadcaster({ id: "s", name: "server", address: "127.0.0.1", port: 48200 }, interfaces);
  const scanner = new DiscoveryScanner(interfaces);
  const errors: Error[] = [];
  server.on("network-error", e => errors.push(e)); scanner.on("network-error", e => errors.push(e));
  server.start(); scanner.start(); server.stop(); scanner.stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(errors).toEqual([]);
});

it("keeps healthy interfaces broadcasting and throttles repeated send failures", async () => {
  const { vi } = await import("vitest");
  const { EventEmitter } = await import("node:events");
  const { default: dgram } = await import("node:dgram");
  const { DiscoveryBroadcaster } = await import("../../src/main/discovery");
  vi.useFakeTimers(); vi.setSystemTime(0);
  const sent: string[] = [];
  const spy = vi.spyOn(dgram, "createSocket").mockImplementation(() => {
    const socket = new EventEmitter() as any;
    let host = "";
    socket.bind = (_port: number, address: string, ready: () => void) => { host = address; queueMicrotask(ready); };
    socket.setBroadcast = () => {};
    socket.close = () => {};
    socket.send = (_message: Buffer, _port: number, address: string, done: (error?: Error) => void) => {
      sent.push(`${host} -> ${address}`);
      done(host === "192.0.2.1" ? new Error("EHOSTUNREACH") : undefined);
    };
    return socket;
  });
  const server = new DiscoveryBroadcaster({ id: "test", name: "test", address: "192.0.2.1", port: 48200 }, () => [
    { name: "broken", address: "192.0.2.1", broadcast: "192.0.2.255" },
    { name: "working", address: "10.1.2.3", broadcast: "10.1.2.255" }
  ]);
  const errors: Error[] = []; server.on("network-error", error => errors.push(error));
  try {
    server.start(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(3000);
    expect(sent.filter(s => s === "10.1.2.3 -> 10.1.2.255").length).toBeGreaterThan(1);
    expect(sent.some(s => s.includes("255.255.255.255"))).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("本地网络权限");
  } finally { server.stop(); spy.mockRestore(); vi.useRealTimers(); }
});
