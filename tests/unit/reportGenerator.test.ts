import { describe, expect, it } from "vitest";
import { buildReportSummary, renderReportHtml } from "../../src/main/reportGenerator";
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
