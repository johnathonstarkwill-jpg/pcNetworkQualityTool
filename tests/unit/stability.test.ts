import { expect, it } from "vitest";
import { summarizeStability } from "../../src/shared/stability";
import { trendPaths, throughputSvg } from "../../src/shared/throughputChart";
import type { ThroughputSample } from "../../src/shared/types";
const sample = (start: number, end: number, mbps: number): ThroughputSample => ({ startSeconds: start, endSeconds: end, mbps, side: "receiver" });
it("weights irregular intervals and distinguishes zero throughput from missing observations", () => {
  const stats = summarizeStability([sample(0, 1, 10), sample(1, 3, 0), sample(4, 5, 0), sample(5, 6, 20)], 7)!;
  expect(stats).toMatchObject({ sampleCount: 4, observedSeconds: 5, minMbps: 0, avgMbps: 6, maxMbps: 20, zeroEvents: 2, zeroSeconds: 3, longestZeroSeconds: 2, missingSeconds: 2 });
  expect(stats.stddevMbps).toBeCloseTo(8);
  expect(stats.cvPercent).toBeCloseTo(800 / 6);
  expect(trendPaths([sample(0, 1, 10), sample(2, 3, 10)]).paths).toHaveLength(2);
});
it("keeps missing and all-zero series distinct and filters invalid intervals", () => {
  expect(summarizeStability([])).toBeUndefined();
  expect(summarizeStability([sample(0, 2, 0)])).toMatchObject({ avgMbps: 0, zeroSeconds: 2, zeroEvents: 1 });
  expect(summarizeStability([sample(0, 2, 0)])?.cvPercent).toBeUndefined();
  expect(summarizeStability([sample(0, 0, 2), sample(0, 1, -1)])).toBeUndefined();
});
it("retains short drops in long-run chart buckets and labels the observation side", () => {
  const samples = Array.from({ length: 3600 }, (_, i) => sample(i, i + 1, i === 100 ? 0 : 10));
  const chart = trendPaths(samples);
  expect(chart.paths[0]).toContain(',136.00');
  expect(throughputSvg(samples)).toContain('接收端');
  expect(throughputSvg(samples)).not.toContain('NaN');
});
