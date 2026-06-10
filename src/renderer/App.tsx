import { useEffect, useState } from "react";
import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types";

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

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getServerState().then(setState);
    return window.networkTool.onServerState(setState);
  }, []);

  // When a real report becomes available, fetch its rendered HTML once.
  const reportId = state?.latestReport?.id;
  useEffect(() => {
    if (!window.networkTool || !reportId) return;
    void window.networkTool.getLatestReportHtml().then(setReportHtml);
  }, [reportId]);

  const testing = Boolean(state?.activePlan);
  const hasClients = (state?.clients.filter((c) => c.status !== "disconnected").length ?? 0) > 0;

  async function startTest(suiteId: TestSuiteId) {
    try {
      const started = await window.networkTool.startTest(suiteId);
      if (!started) alert("暂无客户端连接，无法开始测试");
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
                  {c.name}（{c.address}）— {CLIENT_STATUS_LABELS[c.status]}
                  {state.testingClientId === c.id ? " · 测试中" : ""}
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
            {suites.map((suite) => (
              <button
                key={suite.id}
                type="button"
                className="suite-button"
                disabled={testing || !hasClients}
                onClick={() => void startTest(suite.id)}
              >
                <strong>{suite.label}</strong>
                <span>{suite.description}</span>
              </button>
            ))}
          </div>
          {reportHtml ? (
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : null}
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
                    <th>抖动 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lastResult.map((phase) => (
                    <tr key={phase.phaseId}>
                      <td>{phase.phaseId}</td>
                      <td>{format(phase.throughputMbps)}</td>
                      <td>{format(phase.udpLossPercent)}</td>
                      <td>{format(phase.jitterMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
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
  return value === undefined ? "-" : value.toFixed(2);
}
