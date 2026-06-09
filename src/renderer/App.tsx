import { useState } from "react";
import type { AppRole } from "../shared/types";

export function App() {
  const [role, setRole] = useState<AppRole>("unset");

  return (
    <main className="app-shell">
      <section className="role-panel">
        <h1>网络质量测试工具</h1>
        <p>请选择这台电脑在本次测试中的角色。</p>
        <div className="role-actions">
          <button type="button" onClick={() => setRole("server")}>
            作为服务器
          </button>
          <button type="button" onClick={() => setRole("client")}>
            作为客户端
          </button>
        </div>
        <p className="status-line">
          当前角色：{role === "unset" ? "未选择" : role === "server" ? "服务器" : "客户端"}
        </p>
      </section>
    </main>
  );
}
