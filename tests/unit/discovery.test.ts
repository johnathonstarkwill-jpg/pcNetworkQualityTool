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
