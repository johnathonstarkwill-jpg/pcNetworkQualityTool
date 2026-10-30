import type { RttStats, StabilityStats, ThroughputSample } from "./types.js";

export function summarizeRtt(values: number[]): RttStats | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    max: sorted[sorted.length - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], p99: sorted[Math.ceil(sorted.length * .99) - 1] };
}

// Duration-weighted interval statistics. Missing observations are not zero traffic.
export function summarizeStability(samples: ThroughputSample[], totalSeconds?: number): StabilityStats | undefined {
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((a, b) => a.startSeconds - b.startSeconds);
  let observedSeconds = 0, weightedSum = 0, lastEnd = 0;
  let zeroSeconds = 0, currentZero = 0, longestZeroSeconds = 0, zeroEvents = 0, missingSeconds = 0;
  const valid: ThroughputSample[] = [];
  for (const s of sorted) {
    if (!Number.isFinite(s.mbps) || s.mbps < 0 || !Number.isFinite(s.startSeconds) || !Number.isFinite(s.endSeconds)
      || s.startSeconds < lastEnd - .001 || s.startSeconds < 0 || s.endSeconds <= s.startSeconds) continue;
    const gap = Math.max(0, s.startSeconds - lastEnd);
    if (gap > .01) { missingSeconds += gap; currentZero = 0; }
    const duration = s.endSeconds - s.startSeconds;
    valid.push(s); observedSeconds += duration; weightedSum += s.mbps * duration;
    if (s.mbps === 0) {
      if (currentZero === 0) zeroEvents++;
      currentZero += duration; zeroSeconds += duration;
      longestZeroSeconds = Math.max(longestZeroSeconds, currentZero);
    } else currentZero = 0;
    lastEnd = s.endSeconds;
  }
  if (!valid.length) return undefined;
  missingSeconds += Math.max(0, (totalSeconds ?? lastEnd) - lastEnd);
  const avgMbps = weightedSum / observedSeconds;
  const stddevMbps = Math.sqrt(valid.reduce((sum, s) => sum + (s.mbps - avgMbps) ** 2 * (s.endSeconds - s.startSeconds), 0) / observedSeconds);
  return { sampleCount: valid.length, observedSeconds, minMbps: valid.reduce((m, s) => Math.min(m, s.mbps), Infinity),
    avgMbps, maxMbps: valid.reduce((m, s) => Math.max(m, s.mbps), 0), stddevMbps,
    ...(avgMbps > 0 ? { cvPercent: stddevMbps / avgMbps * 100 } : {}), zeroSeconds, longestZeroSeconds, zeroEvents, missingSeconds };
}
