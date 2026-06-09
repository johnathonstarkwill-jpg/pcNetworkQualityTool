import { contextBridge, ipcRenderer } from "electron";
import type { AppRole, TestSuiteId } from "../shared/types.js";

contextBridge.exposeInMainWorld("networkTool", {
  buildPlan: (suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") =>
    ipcRenderer.invoke("tests:build-plan", suiteId, runMode) as Promise<unknown>,
  getClientState: () => ipcRenderer.invoke("client:get-state") as Promise<unknown>,
  getPermissionGuidance: () => ipcRenderer.invoke("permissions:get-guidance") as Promise<unknown>,
  getRole: () => ipcRenderer.invoke("app:get-role") as Promise<AppRole>,
  getSampleReportHtml: () => ipcRenderer.invoke("reports:sample-html") as Promise<string>,
  getServerState: () => ipcRenderer.invoke("server:get-state") as Promise<unknown>,
  listTestSuites: () => ipcRenderer.invoke("tests:list-suites") as Promise<unknown>,
  setRole: (role: AppRole) => ipcRenderer.invoke("app:set-role", role) as Promise<AppRole>
});
