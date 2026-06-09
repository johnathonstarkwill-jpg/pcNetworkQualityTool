import type { ClientTestResult, ReportSummary, TestReport } from "../shared/types.js";

export function buildReportSummary(results: ClientTestResult[]): ReportSummary {
  const worstLoss = maxDefined(results.flatMap((result) => result.phases.map((phase) => phase.udpLossPercent)));
  const worstJitter = maxDefined(results.flatMap((result) => result.phases.map((phase) => phase.jitterMs)));
  const erroredClient = results.find((result) => result.phases.some((phase) => phase.errors.length > 0));
  const lossClient = results.find((result) => result.phases.some((phase) => (phase.udpLossPercent ?? 0) > 3));

  if (erroredClient) {
    return {
      rating: "不合格",
      conclusion: `${erroredClient.clientName} 测试过程中出现未完成或失败阶段。`,
      recommendation: "请检查客户端连接、防火墙设置和中间网络设备后重新测试。"
    };
  }

  if ((worstLoss ?? 0) > 3) {
    return {
      rating: "不合格",
      conclusion: `${lossClient?.clientName ?? "某客户端"} 出现超过 3% 的 UDP 丢包。`,
      recommendation: "建议检查交换机端口、网线、无线信号或并发占用。"
    };
  }

  if ((worstLoss ?? 0) > 1 || (worstJitter ?? 0) > 30) {
    return {
      rating: "风险",
      conclusion: "网络存在丢包或抖动风险，实时音视频可能受影响。",
      recommendation: "建议在业务高峰期再次进行长时间稳定性测试。"
    };
  }

  if ((worstLoss ?? 0) > 0.1 || (worstJitter ?? 0) > 15) {
    return {
      rating: "合格",
      conclusion: "网络质量合格，可用于常规业务。",
      recommendation: "如用于高清视频或关键业务，建议运行标准验收或长时间稳定性测试。"
    };
  }

  return {
    rating: "优秀",
    conclusion: "网络质量优秀，未发现明显丢包或抖动问题。",
    recommendation: "可用于视频会议和常规高清视频传输。"
  };
}

export function renderReportHtml(report: TestReport): string {
  const clientRows = report.clients
    .map(
      (client) =>
        `<tr><td>${escapeHtml(client.name)}</td><td>${escapeHtml(client.address)}</td><td>${escapeHtml(client.status)}</td></tr>`
    )
    .join("");

  const resultRows = report.results
    .flatMap((result) =>
      result.phases.map(
        (phase) =>
          `<tr><td>${escapeHtml(result.clientName)}</td><td>${escapeHtml(phase.phaseId)}</td><td>${formatNumber(phase.throughputMbps)}</td><td>${formatNumber(phase.udpLossPercent)}</td><td>${formatNumber(phase.jitterMs)}</td><td>${escapeHtml(phase.errors.join("; "))}</td></tr>`
      )
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>网络质量测试报告</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; }
    h1, h2 { margin-bottom: 8px; }
    .rating { display: inline-block; padding: 8px 12px; background: #1261a6; color: #fff; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d9e2e8; padding: 8px; text-align: left; }
    th { background: #eef3f6; }
  </style>
</head>
<body>
  <h1>网络质量测试报告</h1>
  <p class="rating">${escapeHtml(report.summary.rating)}</p>
  <p>${escapeHtml(report.summary.conclusion)}</p>
  <p>${escapeHtml(report.summary.recommendation)}</p>
  <h2>测试信息</h2>
  <p>时间：${escapeHtml(report.createdAt)}</p>
  <p>服务器：${escapeHtml(report.serverName)} - ${escapeHtml(report.serverAddress)}</p>
  <h2>客户端</h2>
  <table><thead><tr><th>名称</th><th>IP</th><th>状态</th></tr></thead><tbody>${clientRows}</tbody></table>
  <h2>详细指标</h2>
  <table><thead><tr><th>客户端</th><th>阶段</th><th>吞吐量 Mbps</th><th>UDP 丢包 %</th><th>抖动 ms</th><th>错误</th></tr></thead><tbody>${resultRows}</tbody></table>
</body>
</html>`;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length === 0 ? undefined : Math.max(...defined);
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[char];
  });
}
