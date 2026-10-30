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
  const scanner = new DiscoveryScanner();
  try {
    const error = new Promise<Error>(resolve => scanner.once("network-error", resolve));
    scanner.start();
    expect((await error).message).toContain("EADDRINUSE");
  } finally { scanner.stop(); blocker.close(); }
});
