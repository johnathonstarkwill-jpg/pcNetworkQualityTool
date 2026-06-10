import { describe, expect, it } from "vitest";
import { buildReportSummary, renderReportHtml, renderReportMarkdown } from "../../src/main/reportGenerator";
import type { TestReport } from "../../src/shared/types";

describe("reportGenerator", () => {
  it("rates excellent results as 优秀", () => {
    const summary = buildReportSummary([
      {
        clientId: "a",
        clientName: "客户端 A",
        phases: [{ phaseId: "udp-quality", udpLossPercent: 0, jitterMs: 2, errors: [] }]
      }
    ]);

    expect(summary.rating).toBe("优秀");
  });

  it("rates packet loss above 3 percent as 不合格", () => {
    const summary = buildReportSummary([
      {
        clientId: "b",
        clientName: "客户端 B",
        phases: [{ phaseId: "udp-quality", udpLossPercent: 3.2, jitterMs: 8, errors: [] }]
      }
    ]);

    expect(summary.rating).toBe("不合格");
    expect(summary.conclusion).toContain("客户端 B");
  });

  it("rates jitter above 30ms as 风险", () => {
    const summary = buildReportSummary([
      {
        clientId: "a",
        clientName: "客户端 A",
        phases: [{ phaseId: "udp-quality", udpLossPercent: 0.2, jitterMs: 35, errors: [] }]
      }
    ]);

    expect(summary.rating).toBe("风险");
  });

  it("escapes html in rendered report fields", () => {
    const report = sampleReport({
      serverName: "<script>alert(1)</script>",
      clients: [{ id: "a", name: "客户端 <A>", address: "192.168.1.11", status: "connected" }]
    });

    const html = renderReportHtml(report);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("客户端 &lt;A&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders html with conclusion and client names", () => {
    const report = sampleReport();
    const html = renderReportHtml(report);

    expect(html).toContain("网络质量合格");
    expect(html).toContain("客户端 A");
    expect(html).toContain("192.168.1.10");
  });
});

describe("renderReportMarkdown", () => {
  const baseReport: TestReport = {
    id: "r1",
    createdAt: "2026-06-10T01:02:03.000Z",
    suiteId: "quick-check",
    serverName: "测试服务器",
    serverAddress: "192.168.0.8",
    clients: [{ id: "c1", name: "客户端 A", address: "192.168.0.9", status: "connected" }],
    results: [
      {
        clientId: "c1",
        clientName: "客户端 A",
        phases: [
          { phaseId: "tcp-upload", throughputMbps: 120.5, errors: [] },
          { phaseId: "udp-quality", throughputMbps: 8, udpLossPercent: 0, jitterMs: 0.5, errors: [] }
        ]
      }
    ],
    summary: { rating: "优秀", conclusion: "网络质量优秀。", recommendation: "可用于视频会议。" }
  };

  it("renders title, rating, conclusion, client name, phase rows, and table separators", () => {
    const md = renderReportMarkdown(baseReport, ["[10:00:00] 开始", "[10:00:01] 完成"]);
    expect(md).toContain("# 网络质量测试报告");
    expect(md).toContain("优秀");
    expect(md).toContain("网络质量优秀。");
    expect(md).toContain("客户端 A");
    expect(md).toContain("tcp-upload");
    expect(md).toContain("| --- |");
  });

  it("includes the run log inside a fenced block", () => {
    const md = renderReportMarkdown(baseReport, ["[10:00:00] 开始测试", "[10:00:01] TCP 上行 1s: 120.5 Mbps"]);
    expect(md).toContain("## 运行日志");
    expect(md).toContain("```");
    expect(md).toContain("[10:00:01] TCP 上行 1s: 120.5 Mbps");
  });

  it("shows (无日志) when the log is empty", () => {
    const md = renderReportMarkdown(baseReport, []);
    expect(md).toContain("(无日志)");
  });

  it("escapes pipe characters in cell values so table rows stay intact", () => {
    const report: TestReport = {
      ...baseReport,
      results: [
        { clientId: "c1", clientName: "A|B", phases: [{ phaseId: "tcp-upload", throughputMbps: 1, errors: [] }] }
      ]
    };
    const md = renderReportMarkdown(report, []);
    expect(md).toContain("A\\|B");
    expect(md).not.toContain("| A|B |");
  });

  it("formats missing numeric metrics as -", () => {
    const md = renderReportMarkdown(baseReport, []);
    expect(md).toContain("| 客户端 A | tcp-upload | 120.50 | - | - |  |");
  });
});

function sampleReport(overrides: Partial<TestReport> = {}): TestReport {
  return {
    id: "report-1",
    createdAt: "2026-06-09T00:00:00.000Z",
    suiteId: "quick-check",
    serverName: "服务器",
    serverAddress: "192.168.1.10",
    clients: [{ id: "a", name: "客户端 A", address: "192.168.1.11", status: "connected" }],
    results: [{ clientId: "a", clientName: "客户端 A", phases: [] }],
    summary: {
      rating: "合格",
      conclusion: "网络质量合格。",
      recommendation: "可用于常规业务。"
    },
    ...overrides
  };
}
