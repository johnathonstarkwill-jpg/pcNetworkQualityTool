import { throughputSvg } from "../shared/throughputChart.js";
import { PHASE_LABELS as LABELS } from "../shared/measurements.js";
import type { ClientTestResult, PhaseMetrics, ReportSummary, TestReport } from "../shared/types.js";

export function buildReportSummary(results: ClientTestResult[]): ReportSummary {
  const phases = results.flatMap(r => r.phases);
  const completedPhases = phases.filter(p => p.errors.length === 0).length;
  return { totalPhases: phases.length, completedPhases, incompletePhases: phases.length - completedPhases };
}

const HEADERS = ["客户端", "阶段", "采集状态", "目标速率 Mbps", "接收速率 Mbps", "发送速率 Mbps", "接收字节 B", "实测时长 s", "TCP 重传次数", "已发/已收/丢失包数", "丢包率 %", "UDP 抖动 ms", "RTT 样本数", "RTT min/avg/max ms", "RTT p95/p99 ms", "说明"];
function number(v: number | undefined): string { return v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(3); }
function count(v: number | undefined): string { return v === undefined ? "—" : String(v); }
function cells(name: string, p: PhaseMetrics): string[] {
  return [name, LABELS[p.phaseId] ?? p.phaseId, p.errors.length ? "未完成" : "已完成", number(p.targetBitrateMbps),
    number(p.throughputMbps), number(p.senderMbps), count(p.bytesReceived), number(p.durationSeconds), count(p.retransmits),
    `${count(p.packetsSent)} / ${count(p.packetsReceived)} / ${count(p.packetsLost)}`,
    number(p.udpLossPercent ?? p.packetLossPercent), number(p.jitterMs), count(p.rttSamples),
    p.latencyMs ? [p.latencyMs.min, p.latencyMs.avg, p.latencyMs.max].map(number).join(" / ") : "—",
    p.latencyMs ? [p.latencyMs.p95, p.latencyMs.p99].map(number).join(" / ") : "—",
    [...p.errors, ...(p.notes ?? []), ...(p.loadedLatency?.errors ?? []), ...(p.loadedLatency?.notes ?? []), ...(p.reachable === true ? ["端口可达"] : [])].join("；")];
}
const LOAD_HEADERS = ["客户端", "负载方向", "RTT 样本数", "负载 RTT min/avg/max ms", "负载 RTT p95/p99 ms", "平均 RTT 增量 ms", "p95 RTT 增量 ms", "探测丢包率 %", "说明"];
const STABILITY_HEADERS = ["客户端", "阶段", "观测端", "样本数", "观测时长 s", "逐秒 min/avg/max Mbps", "标准差 Mbps", "变异系数 %", "零吞吐次数", "零吞吐累计/最长 s", "采样缺口 s"];
function loadRows(report: TestReport): string[][] {
  return report.results.flatMap(r => r.phases.filter(p => p.phaseId === "tcp-upload" || p.phaseId === "tcp-download").map(p => {
    const l = p.loadedLatency, t = l?.latencyMs;
    return [r.clientName, LABELS[p.phaseId], count(l?.rttSamples), t ? [t.min, t.avg, t.max].map(number).join(" / ") : "—",
      t ? [t.p95, t.p99].map(number).join(" / ") : "—", number(l?.deltaAvgMs), number(l?.deltaP95Ms), number(l?.packetLossPercent),
      l ? [...l.errors, ...l.notes].join("；") : "未采集负载 RTT"];
  }));
}
function stabilityRows(report: TestReport): string[][] {
  return report.results.flatMap(r => r.phases.filter(p => p.phaseId.startsWith("tcp") || p.phaseId.startsWith("udp")).map(p => {
    const s = p.stability;
    return [r.clientName, LABELS[p.phaseId], p.throughputSeriesSide === "sender" ? "发送端" : p.throughputSeriesSide === "receiver" ? "接收端" : "—",
      count(s?.sampleCount), number(s?.observedSeconds), s ? [s.minMbps, s.avgMbps, s.maxMbps].map(number).join(" / ") : "—", number(s?.stddevMbps), number(s?.cvPercent),
      count(s?.zeroEvents), s ? [s.zeroSeconds, s.longestZeroSeconds].map(number).join(" / ") : "—", number(s?.missingSeconds)];
  }));
}
function htmlTable(headers: string[], rows: string[][]): string {
  return `<div class="metrics-scroll" tabindex="0" role="region" aria-label="测试数据表格，可横向滚动"><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function mdTable(headers: string[], rows: string[][]): string {
  return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows.map(row => `| ${row.map(mdCell).join(" | ")} |`).join("\n")}`;
}
function intervalRows(report: TestReport): string[][] {
  return report.results.flatMap(r => r.phases.flatMap(p => (p.intervals ?? []).map(s => [r.clientName, (LABELS[p.phaseId] ?? p.phaseId), number(s.startSeconds), number(s.endSeconds), number(s.mbps), s.side === "sender" ? "发送端" : "接收端"])));
}
const METHODS = "TCP 负载 RTT 在数据流出现后并行采样，流结束时丢弃尚未完成的探测；增量为负载值减同轮空载值，可能为负。趋势与稳定性来自客户端的逐秒观测（上行是发送端、下行是接收端），与最终接收端平均吞吐量口径不同。零吞吐仅统计实测 0 Mbps 的区间；采样缺口单独统计，不能直接认定为断流。标准差与变异系数按采样时长加权；变异系数 = 标准差 / 平均值 × 100%。Mbps = 1,000,000 bit/s。上行/下行以客户端为参照；吞吐量取 iperf3 接收端，发送速率与 TCP 重传取发送端。UDP 丢包率和包间到达抖动取接收端统计，不是 RTT。空载 ICMP Echo 在吞吐测试前采样，负载探测约每秒一轮；RTT 仅统计成功响应，p95/p99 使用最近秩法，小样本时可能等于最大值。ICMP 丢包与 UDP 丢包分别列在对应阶段；不推断单向时延。— 表示未采集或不适用，不代表 0。不作质量评级。";
function progress(report: TestReport): string {
  return `已完成 ${report.summary.completedPhases} / ${report.summary.totalPhases} 个阶段；未完成 ${report.summary.incompletePhases} 个阶段。`;
}
export function renderReportHtml(report: TestReport): string {
  const rows = report.results.flatMap(r => r.phases.map(p => `<tr>${cells(`${r.clientName}${r.serverAddress ? ` → ${r.serverAddress}` : ""}`, p).map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)).join("");
  const plan = report.plan?.phases.map(p => `${LABELS[p.kind]}：${p.durationSeconds}s${p.targetBitrateMbps === undefined ? "" : `，目标 ${p.targetBitrateMbps} Mbps`}`).join("；") ?? "未记录";
  return `<section class="measurement-report"><h1>网络质量测试数据</h1><p>${escapeHtml(progress(report))}</p>
<h2>测试信息</h2><p>时间：${escapeHtml(report.createdAt)}</p><p>服务器：${escapeHtml(report.serverName)} - ${escapeHtml(report.serverAddress)}</p><p>套件：${escapeHtml(report.suiteId)}；逐客户端、逐阶段执行</p><p>计划：${escapeHtml(plan)}</p>
<h2>客户端</h2><ul>${report.clients.map(c => `<li>${escapeHtml(c.name)} — ${escapeHtml(c.address)}</li>`).join("")}</ul>
<h2>实测指标</h2><p>表格可横向滚动查看全部指标。</p><div class="metrics-scroll" tabindex="0" role="region" aria-label="实测指标，可横向滚动"><table><thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
<h2>负载下延迟</h2>${htmlTable(LOAD_HEADERS, loadRows(report))}
<h2>吞吐稳定性</h2>${htmlTable(STABILITY_HEADERS, stabilityRows(report))}
<h2>吞吐量趋势</h2>${report.results.flatMap(r => r.phases.filter(p => p.intervals?.length).map(p => `<figure><figcaption>${escapeHtml(r.clientName)} · ${escapeHtml(LABELS[p.phaseId] ?? p.phaseId)} · ${p.throughputSeriesSide === "receiver" ? "接收端" : "发送端"} Mbps</figcaption>${throughputSvg(p.intervals!)}</figure>`)).join("")}
<h2>测量口径</h2><p>${METHODS}</p></section>`;
}
export function renderReportMarkdown(report: TestReport, log: string[]): string {
  const rows = report.results.flatMap(r => r.phases.map(p => `| ${cells(`${r.clientName}${r.serverAddress ? ` → ${r.serverAddress}` : ""}`, p).map(mdCell).join(" | ")} |`)).join("\n");
  const plan = report.plan?.phases.map(p => `- ${LABELS[p.kind]}：${p.durationSeconds} s${p.targetBitrateMbps === undefined ? "" : `，目标 ${p.targetBitrateMbps} Mbps`}`).join("\n") ?? "未记录";
  return `# 网络质量测试数据\n\n${progress(report)}\n\n## 测试信息\n\n- 时间：${report.createdAt}\n- 服务器：${mdCell(report.serverName)} - ${mdCell(report.serverAddress)}\n- 套件：${mdCell(report.suiteId)}\n- 执行方式：逐客户端、逐阶段\n\n## 测试计划\n\n${plan}\n\n## 客户端\n\n| 名称 | IP |\n| --- | --- |\n${report.clients.map(c => `| ${mdCell(c.name)} | ${mdCell(c.address)} |`).join("\n")}\n\n## 实测指标\n\n| ${HEADERS.join(" | ")} |\n| ${HEADERS.map(() => "---").join(" | ")} |\n${rows}\n\n## 负载下延迟\n\n${mdTable(LOAD_HEADERS, loadRows(report))}\n\n## 吞吐稳定性\n\n${mdTable(STABILITY_HEADERS, stabilityRows(report))}\n\n## 每秒吞吐量明细\n\n${mdTable(["客户端", "阶段", "开始 s", "结束 s", "吞吐量 Mbps", "观测端"], intervalRows(report))}\n\n## 测量口径\n\n${METHODS}\n\n## 运行日志\n\n${(log.length ? log : ["(无日志)"]).map(l => `    ${l.replace(/\r?\n/g, "\n    ")}`).join("\n")}\n`;
}
function mdCell(v: string): string { return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }
function escapeHtml(v: string): string { return v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!); }
