import { useEffect, useRef, useState } from "react";
import { throughputSvg } from "../shared/throughputChart";
import { PHASE_LABELS } from "../shared/measurements";
import type { AppRole, ClientSessionState, SuiteStatus, ServerSessionState, TestSuiteId, LiveProgress } from "../shared/types";

interface SuiteView {
  id: TestSuiteId;
  label: string;
  description: string;
}

export function App() {
  const [role, setRoleState] = useState<AppRole>("unset");
  const [suites, setSuites] = useState<SuiteView[]>([]);

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getRole().then(setRoleState);
    void window.networkTool.listTestSuites().then(setSuites);
  }, []);

  async function setRole(nextRole: AppRole) {
    if (!window.networkTool) {
      setRoleState(nextRole);
      return;
    }
    const savedRole = await window.networkTool.setRole(nextRole);
    setRoleState(savedRole);
  }

  if (role === "server") {
    return <ServerScreen suites={suites} onBack={() => void setRole("unset")} />;
  }

  if (role === "client") {
    return <ClientScreen onBack={() => void setRole("unset")} />;
  }

  return (
    <main className="app-shell">
      <section className="role-panel">
        <h1>网络质量测试工具</h1>
        <p>请选择这台电脑在本次测试中的角色。</p>
        <div className="role-actions">
          <button type="button" onClick={() => void setRole("server")}>
            作为服务器
          </button>
          <button type="button" onClick={() => void setRole("client")}>
            作为客户端
          </button>
        </div>
      </section>
    </main>
  );
}

function ServerScreen({ suites, onBack }: { suites: SuiteView[]; onBack: () => void }) {
  const [state, setState] = useState<ServerSessionState | undefined>(undefined);
  const [reportHtml, setReportHtml] = useState<string>("");
  const [exportNote, setExportNote] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Intentionally never cleared: a reconnecting client is treated as known
  // (kept unchecked unless it was still selected), not auto-reselected.
  const seenRef = useRef<Set<string>>(new Set());

  const connectedIds = state?.clients.filter((c) => c.status === "connected").map((c) => c.id) ?? [];
  const connectedKey = [...connectedIds].sort().join(",");

  useEffect(() => {
    const newlyConnected = connectedIds.filter((id) => !seenRef.current.has(id));
    connectedIds.forEach((id) => seenRef.current.add(id));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of connectedIds) {
        // default-select clients we have not seen before; otherwise keep the operator's choice
        if (newlyConnected.includes(id) || prev.has(id)) next.add(id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey]);

  function toggleClient(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getServerState().then(setState);
    return window.networkTool.onServerState(setState);
  }, []);

  // When a real report becomes available, fetch its rendered HTML once.
  const reportId = state?.latestReport?.id;
  useEffect(() => {
    setReportHtml("");
    if (!window.networkTool || !reportId) return;
    let cancelled = false;
    void window.networkTool.getLatestReportHtml().then(html => { if (!cancelled) setReportHtml(html); });
    return () => { cancelled = true; };
  }, [reportId]);

  const testing = Boolean(state?.activePlan);

  async function exportMarkdown() {
    setExportNote("");
    try {
      const result = await window.networkTool.exportReportMarkdown();
      if (result.saved) setExportNote(`已导出：${result.path ?? ""}`);
    } catch {
      setExportNote("导出失败，请重试");
    }
  }

  async function startTest(suiteId: TestSuiteId) {
    try {
      const started = await window.networkTool.startTest(suiteId, [...selectedIds]);
      if (!started) alert("请选择至少一个已连接客户端，再开始测试");
    } catch {
      alert("启动测试时发生错误，请重试");
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>服务器模式</h1>
          <p>请把下面的 IP 告诉客户端电脑，或等待自动发现。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>本机地址</h2>
          {state && state.localAddresses.length > 0 ? (
            <ul className="address-list">
              {state.localAddresses.map((address) => (
                <li key={address}>{address}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">未检测到本地网络地址</p>
          )}
          <h2>已连接客户端</h2>
          {state && state.clients.length > 0 ? (
            <ul className="client-list">
              {state.clients.map((c) => (
                <li key={c.id}>
                  <label className="client-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      disabled={c.status !== "connected" || testing}
                      onChange={() => toggleClient(c.id)}
                    />
                    <span>
                      {c.name}（{c.address}）— {CLIENT_STATUS_LABELS[c.status]}
                      {state.testingClientId === c.id ? " · 测试中" : ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无客户端连接</p>
          )}
        </div>
        <div className="panel">
          <h2>测试套件</h2>
          {testing ? <p className="empty">测试进行中…</p> : null}
          <div className="suite-list">
            {suites.map((suite) => {
              const colorClass =
                state?.activePlan?.suiteId === suite.id ? "suite-running" : statusClass(state?.suiteStatuses[suite.id]);
              return (
                <button
                  key={suite.id}
                  type="button"
                  className={`suite-button ${colorClass}`.trim()}
                  disabled={testing || selectedIds.size === 0}
                  onClick={() => void startTest(suite.id)}
                >
                  <strong>{suite.label}</strong>
                  <span>{suite.description}</span>
                </button>
              );
            })}
          </div>
          {state?.latestReport ? (
            <div className="report-actions">
              <button type="button" className="secondary" onClick={() => void exportMarkdown()}>
                导出 Markdown
              </button>
              {exportNote ? <span className="export-note">{exportNote}</span> : null}
            </div>
          ) : null}
          <LiveTrend progress={state?.liveProgress} />
          {reportHtml ? (
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : null}
          <h2>运行日志</h2>
          <LogConsole lines={state?.log ?? []} />
        </div>
      </section>
    </main>
  );
}

function ClientScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<ClientSessionState | undefined>(undefined);
  const [manualIp, setManualIp] = useState<string>("");

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getClientState().then(setState);
    return window.networkTool.onClientState(setState);
  }, []);

  const connected = state?.status === "connected" || state?.status === "testing";

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>客户端模式</h1>
          <p>{state?.statusText ?? "正在搜索测试服务器。"}</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      {state?.currentSuite ? (
        <div
          className={`suite-status ${
            state.currentSuite.status === "running" ? "suite-running" : statusClass(state.currentSuite.status)
          }`.trim()}
        >
          当前套件：{state.currentSuite.label} ·{" "}
          {state.currentSuite.status === "running" ? "进行中" : state.currentSuite.status === "completed" ? "数据采集完成" : "存在未完成阶段"}
        </div>
      ) : null}
      <section className="panel">
        <h2>服务器搜索</h2>
        {state && state.discoveredServers.length > 0 ? (
          <ul className="server-list">
            {state.discoveredServers.map((srv) => (
              <li key={srv.id}>
                <button type="button" className="suite-button" onClick={() => void window.networkTool.connectToServer(srv.id)}>
                  <strong>{srv.name}</strong>
                  <span>{srv.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">正在搜索服务器。如果长时间没有结果，请使用手动 IP 连接。</p>
        )}
        <label className="manual-ip">
          手动输入服务器 IP
          <input
            type="text"
            placeholder="例如 192.168.1.23"
            value={manualIp}
            onChange={(event) => setManualIp(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void window.networkTool.connectToAddress(manualIp)}
          disabled={manualIp.trim().length === 0}
        >
          连接
        </button>

        {connected ? (
          <div className="test-block">
            <button type="button" onClick={() => void window.networkTool.runManualTest()} disabled={state?.status === "testing"}>
              {state?.status === "testing" ? "测试中…" : "测试到服务器"}
            </button>
            {state?.lastResult ? (
              <table className="result-table">
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>吞吐量 Mbps</th>
                    <th>UDP 丢包 %</th>
                    <th>UDP 抖动 ms</th>
                    <th>RTT min/avg/max ms</th>
                    <th>RTT p95/p99 ms</th>
                    <th>已发/已收/丢失包数</th>
                    <th>ICMP 丢包 %</th>
                    <th>TCP 重传</th>
                    <th>负载 RTT avg / p95 ms</th>
                    <th>平均 RTT 增量 ms</th>
                    <th>吞吐 min / avg / max Mbps</th>
                    <th>标准差 Mbps / 变异系数 %</th>
                    <th>采样缺口 s</th>
                    <th>零吞吐累计 / 最长 s</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lastResult.map((phase) => (
                    <tr key={phase.phaseId}>
                      <td>{PHASE_LABELS[phase.phaseId] ?? phase.phaseId}</td>
                      <td>{format(phase.throughputMbps)}</td>
                      <td>{format(phase.udpLossPercent)}</td>
                      <td>{format(phase.jitterMs)}</td>
                      <td>{phase.latencyMs ? [phase.latencyMs.min, phase.latencyMs.avg, phase.latencyMs.max].map(format).join(" / ") : "—"}</td>
                      <td>{phase.latencyMs ? [phase.latencyMs.p95, phase.latencyMs.p99].map(format).join(" / ") : "—"}</td>
                      <td>{[phase.packetsSent, phase.packetsReceived, phase.packetsLost].map(v => v ?? "—").join(" / ")}</td>
                      <td>{format(phase.packetLossPercent)}</td>
                      <td>{phase.retransmits ?? "—"}</td>
                      <td>{phase.loadedLatency?.latencyMs ? [phase.loadedLatency.latencyMs.avg, phase.loadedLatency.latencyMs.p95].map(format).join(" / ") : "—"}</td>
                      <td>{format(phase.loadedLatency?.deltaAvgMs)}</td>
                      <td>{phase.stability ? [phase.stability.minMbps, phase.stability.avgMbps, phase.stability.maxMbps].map(format).join(" / ") : "—"}</td>
                      <td>{phase.stability ? [phase.stability.stddevMbps, phase.stability.cvPercent].map(format).join(" / ") : "—"}</td>
                      <td>{format(phase.stability?.missingSeconds)}</td>
                      <td>{phase.stability ? [phase.stability.zeroSeconds, phase.stability.longestZeroSeconds].map(format).join(" / ") : "—"}</td>
                      <td>{[...phase.errors, ...(phase.loadedLatency?.errors ?? []), ...(phase.loadedLatency?.notes ?? []), ...(phase.notes ?? [])].join("；")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
        {state?.lastResult?.filter(p => p.intervals?.length).map(p => <figure key={p.phaseId}>
          <figcaption>{PHASE_LABELS[p.phaseId]} · {p.throughputSeriesSide === "receiver" ? "接收端" : "发送端"} Mbps</figcaption>
          <div dangerouslySetInnerHTML={{ __html: throughputSvg(p.intervals!) }} />
        </figure>)}
        <LiveTrend progress={state?.liveProgress} />
        <h2>运行日志</h2>
        <LogConsole lines={state?.log ?? []} />
      </section>
    </main>
  );
}

const CLIENT_STATUS_LABELS: Record<"connected" | "testing" | "disconnected", string> = {
  connected: "已连接",
  testing: "测试中",
  disconnected: "已断开"
};

function format(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(3);
}

function statusClass(status: SuiteStatus | undefined): string {
  return status === "completed" || status === "incomplete" ? "suite-completed" : "";
}

function LogConsole({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <pre className="log-console" ref={ref}>
      {lines.length > 0 ? lines.join("\n") : "// 暂无日志"}
    </pre>
  );
}

function LiveTrend({ progress }: { progress?: LiveProgress }) {
  if (!progress?.intervals.length) return null;
  return <section className="live-trend"><h2>实时吞吐量趋势</h2>
    <p>{PHASE_LABELS[progress.phaseId] ?? progress.phaseId} · 最近 120 个采样区间 · {progress.intervals[0].side === "receiver" ? "接收端" : "发送端"} Mbps</p>
    <div dangerouslySetInnerHTML={{ __html: throughputSvg(progress.intervals) }} />
  </section>;
}
