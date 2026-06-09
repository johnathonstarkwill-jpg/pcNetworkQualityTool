import { ipcMain } from "electron";
import { ControlClient } from "./controlClient.js";
import { ControlServer } from "./controlServer.js";
import { getPermissionGuidance } from "./permissions.js";
import { buildReportSummary, renderReportHtml } from "./reportGenerator.js";
import { buildTestPlan, listTestSuites } from "./testPlans.js";
import type { AppRole, TestSuiteId } from "../shared/types.js";

const server = new ControlServer();
const client = new ControlClient();
let role: AppRole = "unset";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:get-role", () => role);

  ipcMain.handle("app:set-role", (_event, nextRole: AppRole) => {
    role = nextRole;
    return role;
  });

  ipcMain.handle("server:get-state", () => server.getState());
  ipcMain.handle("client:get-state", () => client.getState());
  ipcMain.handle("permissions:get-guidance", () => getPermissionGuidance());
  ipcMain.handle("reports:sample-html", () => {
    const results = [
      {
        clientId: "client-a",
        clientName: "客户端 A",
        phases: [{ phaseId: "udp-quality", udpLossPercent: 0.2, jitterMs: 8, throughputMbps: 92, errors: [] }]
      }
    ];

    return renderReportHtml({
      id: "sample",
      createdAt: new Date().toISOString(),
      suiteId: "quick-check",
      serverName: "测试服务器",
      serverAddress: "192.168.1.10",
      clients: [{ id: "client-a", name: "客户端 A", address: "192.168.1.11", status: "connected" }],
      results,
      summary: buildReportSummary(results)
    });
  });
  ipcMain.handle("tests:list-suites", () => listTestSuites());

  ipcMain.handle("tests:build-plan", (_event, suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") => {
    return buildTestPlan(suiteId, runMode);
  });
}
