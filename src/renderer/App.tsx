import { useEffect, useState } from "react";
import type { AppRole, TestSuiteId } from "../shared/types";

interface SuiteView {
  id: TestSuiteId;
  label: string;
  description: string;
}

export function App() {
  const [role, setRoleState] = useState<AppRole>("unset");
  const [suites, setSuites] = useState<SuiteView[]>([]);

  useEffect(() => {
    void window.networkTool.getRole().then(setRoleState);
    void window.networkTool.listTestSuites().then(setSuites);
  }, []);

  async function setRole(nextRole: AppRole) {
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
  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>服务器模式</h1>
          <p>等待客户端连接后选择测试套件。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>已连接客户端</h2>
          <p className="empty">暂无客户端连接</p>
        </div>
        <div className="panel">
          <h2>测试套件</h2>
          <div className="suite-list">
            {suites.map((suite) => (
              <button key={suite.id} type="button" className="suite-button">
                <strong>{suite.label}</strong>
                <span>{suite.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function ClientScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>客户端模式</h1>
          <p>正在搜索测试服务器。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="panel">
        <h2>服务器搜索</h2>
        <p className="empty">正在搜索服务器。如果长时间没有结果，请使用手动 IP 连接。</p>
        <label className="manual-ip">
          手动输入服务器 IP
          <input type="text" placeholder="例如 192.168.1.23" />
        </label>
      </section>
    </main>
  );
}
