import { expect, it } from "vitest";
import { finalizePhase } from "../../src/shared/measurements";

it("marks missing, empty and incomplete measurements without manufacturing zeros", () => {
  const phase = { id: "udp-quality", kind: "udp-quality" as const, label: "UDP", durationSeconds: 5, targetBitrateMbps: 8 };
  expect(finalizePhase(phase).errors.length).toBe(1);
  const empty = finalizePhase(phase, { phaseId: phase.id, errors: [] });
  expect(empty.errors[0]).toContain("未采集必要指标");
  expect(empty.throughputMbps).toBeUndefined();
  expect(empty.targetBitrateMbps).toBe(8);
  const zero = finalizePhase(phase, { phaseId: phase.id, throughputMbps: 0, udpLossPercent: 100, jitterMs: 0, packetsSent: 10, packetsLost: 10, errors: [] });
  expect(zero.errors).toEqual([]);
  expect(zero.throughputMbps).toBe(0);
});
