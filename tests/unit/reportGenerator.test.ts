import { describe, expect, it } from "vitest";
import { buildReportSummary, renderReportHtml, renderReportMarkdown } from "../../src/main/reportGenerator";
import type { TestReport } from "../../src/shared/types";

const results = [{ clientId: "a", clientName: "A|<B>", phases: [
  { phaseId: "tcp-upload", throughputMbps: 0, retransmits: 3, errors: [] },
  { phaseId: "udp-quality", errors: ["阶段未完成"] },
  { phaseId: "latency", latencyMs: { min: 1, avg: 2, max: 4, p95: 4, p99: 4 }, rttSamples: 3, errors: [] }
] }];
const report: TestReport = {
  id: "r", createdAt: "2026-10-29T00:00:00Z", suiteId: "quick-check",
  serverName: "<script>alert(1)</script>", serverAddress: "127.0.0.1",
  clients: [{ id: "a", name: "A|<B>", address: "127.0.0.1", status: "connected" }],
  results, summary: buildReportSummary(results)
};
describe("measurement reports", () => {
  it("counts completion without generating quality grades", () => {
    expect(report.summary).toEqual({ totalPhases: 3, completedPhases: 2, incompletePhases: 1 });
    expect(buildReportSummary([])).toEqual({ totalPhases: 0, completedPhases: 0, incompletePhases: 0 });
  });
  it("renders measured values, missing values and errors in both formats", () => {
    for (const output of [renderReportHtml(report), renderReportMarkdown(report, [])]) {
      expect(output).toContain("0.000");
      expect(output).toContain("阶段未完成");
      expect(output).toContain("—");
      expect(output).toContain("RTT p95/p99");
      expect(output).toContain("TCP 重传");
      expect(output).toContain("2 / 3");
      expect(output).not.toMatch(/优秀|不合格|风险|可用于视频|评级：/);
    }
  });
  it("escapes HTML and Markdown cells and confines arbitrary logs", () => {
    const html = renderReportHtml(report);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    const md = renderReportMarkdown(report, ["```\n<script>x</script>"]);
    expect(md).toContain("A\\|&lt;B&gt;");
    expect(md).toContain("    ```\n    <script>");
    expect(renderReportMarkdown(report, [])).toContain("(无日志)");
  });
});

it("exports latency increases, stability and every interval without quality ratings", () => {
  const enriched: TestReport = { ...report, results: [{ clientId: "a", clientName: "A", phases: [{ phaseId: "tcp-upload", throughputMbps: 10, errors: [],
    intervals: [{ startSeconds: 0, endSeconds: 1, mbps: 0, side: "sender" }], throughputSeriesSide: "sender",
    stability: { sampleCount: 1, observedSeconds: 1, minMbps: 0, avgMbps: 0, maxMbps: 0, stddevMbps: 0, zeroSeconds: 1, longestZeroSeconds: 1, zeroEvents: 1, missingSeconds: 0 },
    loadedLatency: { rttSamples: 1, packetsSent: 1, packetsReceived: 1, packetsLost: 0, deltaAvgMs: -2, notes: [], errors: [] }
  }] }] };
  const html = renderReportHtml(enriched), md = renderReportMarkdown(enriched, []);
  for (const output of [html, md]) {
    expect(output).toContain("负载下延迟"); expect(output).toContain("-2.000");
    expect(output).toContain("零吞吐累计/最长 s"); expect(output).not.toMatch(/优秀|不合格|风险/);
  }
  expect(html).toContain("<svg");
  expect(md).toContain("## 每秒吞吐量明细");
  expect(md).toContain("| A | TCP 上行（客户端 → 服务器） | 0.000 | 1.000 | 0.000 | 发送端 |");
});
