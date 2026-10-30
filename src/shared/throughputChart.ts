import type { ThroughputSample } from "./types.js";

// Min/max per horizontal bucket preserves short dips when long runs are plotted.
export function trendPaths(samples: ThroughputSample[]): { paths: string[]; maxMbps: number; endSeconds: number } {
  const valid = samples.filter(s => Number.isFinite(s.mbps) && s.mbps >= 0 && Number.isFinite(s.startSeconds)
    && Number.isFinite(s.endSeconds) && s.startSeconds >= 0 && s.endSeconds > s.startSeconds);
  const maxMbps = valid.reduce((m, s) => Math.max(m, s.mbps), 0);
  const endSeconds = valid.reduce((m, s) => Math.max(m, s.endSeconds), 0);
  const segments: ThroughputSample[][] = [];
  for (const s of valid) {
    const segment = segments[segments.length - 1];
    const previous = segment?.[segment.length - 1];
    if (!previous || s.startSeconds - previous.endSeconds > .02) segments.push([s]);
    else segment.push(s);
  }
  const paths = segments.map(segment => {
    const points: ThroughputSample[] = [];
    const bucketSize = Math.max(1, Math.ceil(segment.length / 240));
    for (let i = 0; i < segment.length; i += bucketSize) {
      const bucket = segment.slice(i, i + bucketSize);
      const low = bucket.reduce((a, b) => a.mbps < b.mbps ? a : b);
      const high = bucket.reduce((a, b) => a.mbps > b.mbps ? a : b);
      points.push(...[...new Set([bucket[0], low, high, bucket[bucket.length - 1]])].sort((a, b) => a.startSeconds - b.startSeconds));
    }
    return points.map(s => {
      const x1 = 48 + s.startSeconds / endSeconds * 650;
      const x2 = 48 + s.endSeconds / endSeconds * 650;
      const y = 136 - s.mbps / (maxMbps || 1) * 112;
      return `${x1.toFixed(2)},${y.toFixed(2)} ${x2.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  });
  return { paths, maxMbps, endSeconds };
}

export function throughputSvg(samples: ThroughputSample[]): string {
  const { paths, maxMbps, endSeconds } = trendPaths(samples);
  if (!paths.length) return "<p>暂无吞吐量采样。</p>";
  const source = samples[0].side === "receiver" ? "接收端" : "发送端";
  return `<svg viewBox="0 0 720 168" role="img" aria-label="${source}吞吐量随时间变化，单位 Mbps" style="width:100%;min-width:300px;background:#f8fafc;color:#172026">
<title>${source}吞吐量趋势；横轴秒，纵轴 Mbps；采样缺口不连线</title>
<path d="M48 24V136H698" fill="none" stroke="#94a3b8"/>
<text x="4" y="22" font-size="12" fill="currentColor">${maxMbps.toFixed(2)}</text><text x="4" y="138" font-size="12" fill="currentColor">0</text>
<text x="48" y="158" font-size="12" fill="currentColor">0 s</text><text x="620" y="158" font-size="12" fill="currentColor">${endSeconds.toFixed(1)} s</text>
${paths.map(points => `<polyline points="${points}" fill="none" stroke="#1261a6" stroke-width="2"/>`).join("")}</svg>`;
}
