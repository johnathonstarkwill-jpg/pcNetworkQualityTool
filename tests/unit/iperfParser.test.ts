import { describe, expect, it } from "vitest";
import { buildIperfArgs, parseIperfJson } from "../../src/main/iperfRunner";

describe("iperfRunner", () => {
  it("builds tcp upload arguments", () => {
    expect(buildIperfArgs({ host: "192.168.1.10", phaseKind: "tcp-upload", durationSeconds: 30 })).toEqual([
      "-c",
      "192.168.1.10",
      "-J",
      "-t",
      "30"
    ]);
  });

  it("builds tcp download reverse arguments", () => {
    expect(buildIperfArgs({ host: "192.168.1.10", phaseKind: "tcp-download", durationSeconds: 30 })).toContain("-R");
  });

  it("builds udp quality arguments with bitrate", () => {
    const args = buildIperfArgs({
      host: "192.168.1.10",
      phaseKind: "udp-quality",
      durationSeconds: 60,
      targetBitrateMbps: 8
    });

    expect(args).toContain("-u");
    expect(args).toContain("-b");
    expect(args).toContain("8M");
  });

  it("rejects invalid arguments", () => {
    expect(() => buildIperfArgs({ host: "", phaseKind: "tcp-upload", durationSeconds: 30 })).toThrow("Invalid host");
    expect(() => buildIperfArgs({ host: "192.168.1.10", phaseKind: "tcp-upload", durationSeconds: 0 })).toThrow(
      "Invalid duration"
    );
    expect(() =>
      buildIperfArgs({
        host: "192.168.1.10",
        phaseKind: "udp-quality",
        durationSeconds: 60,
        targetBitrateMbps: Number.NaN
      })
    ).toThrow("Invalid bitrate");
  });

  it("parses tcp throughput", () => {
    const metrics = parseIperfJson(
      "tcp-upload",
      JSON.stringify({
        end: {
          sum_sent: {
            bits_per_second: 943000000
          }
        }
      })
    );

    expect(metrics.throughputMbps).toBeCloseTo(943, 1);
    expect(metrics.errors).toEqual([]);
  });

  it("parses udp loss and jitter", () => {
    const metrics = parseIperfJson(
      "udp-quality",
      JSON.stringify({
        end: {
          sum: {
            bits_per_second: 7900000,
            lost_percent: 1.25,
            jitter_ms: 4.8
          }
        }
      })
    );

    expect(metrics.throughputMbps).toBeCloseTo(7.9, 1);
    expect(metrics.udpLossPercent).toBe(1.25);
    expect(metrics.jitterMs).toBe(4.8);
  });

  it("returns parser errors for invalid json", () => {
    const metrics = parseIperfJson("tcp-upload", "{");

    expect(metrics.phaseId).toBe("tcp-upload");
    expect(metrics.errors[0]).toContain("Invalid iperf3 JSON");
  });

  it("returns parser errors for missing summary fields", () => {
    const metrics = parseIperfJson("udp-quality", JSON.stringify({ end: {} }));

    expect(metrics.phaseId).toBe("udp-quality");
    expect(metrics.errors[0]).toContain("Missing UDP summary");
  });
});
