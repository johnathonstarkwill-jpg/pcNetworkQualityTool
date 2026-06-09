import { describe, expect, it } from "vitest";
import { buildTestPlan, listTestSuites } from "../../src/main/testPlans";

describe("testPlans", () => {
  it("lists the five first-version suites in UI order", () => {
    expect(listTestSuites().map((suite) => suite.id)).toEqual([
      "quick-check",
      "standard-acceptance",
      "video-meeting",
      "hd-video",
      "long-stability"
    ]);
  });

  it("builds a quick check with short connectivity, tcp, and udp phases", () => {
    const plan = buildTestPlan("quick-check", "single");

    expect(plan.label).toBe("快速检测");
    expect(plan.runMode).toBe("single");
    expect(plan.phases.map((phase) => phase.kind)).toEqual([
      "connectivity",
      "latency",
      "tcp-upload",
      "tcp-download",
      "udp-quality"
    ]);
    expect(plan.phases.every((phase) => phase.durationSeconds <= 20)).toBe(true);
  });

  it("builds HD video with a high target UDP bitrate", () => {
    const plan = buildTestPlan("hd-video", "concurrent");
    const udpPhase = plan.phases.find((phase) => phase.kind === "udp-quality");

    expect(plan.runMode).toBe("concurrent");
    expect(udpPhase?.targetBitrateMbps).toBe(25);
  });

  it("builds long stability with a selected duration", () => {
    const plan = buildTestPlan("long-stability", "separate", { durationSeconds: 3600 });

    expect(plan.phases.some((phase) => phase.durationSeconds === 3600)).toBe(true);
  });
});
