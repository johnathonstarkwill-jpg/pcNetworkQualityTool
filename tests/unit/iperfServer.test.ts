import { describe, expect, it } from "vitest";
import { buildServerArgs } from "../../src/main/iperfServer";

describe("iperfServer", () => {
  it("builds default server args binding all interfaces on the iperf3 port", () => {
    expect(buildServerArgs()).toEqual(["-s", "-p", "5201"]);
  });

  it("accepts a custom port", () => {
    expect(buildServerArgs(5202)).toEqual(["-s", "-p", "5202"]);
  });
});
