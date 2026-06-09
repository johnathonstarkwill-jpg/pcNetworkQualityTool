import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types.js";

contextBridge.exposeInMainWorld("networkTool", {
  buildPlan: (suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") =>
    ipcRenderer.invoke("tests:build-plan", suiteId, runMode),
  getClientState: () => ipcRenderer.invoke("client:get-state") as Promise<ClientSessionState>,
  getPermissionGuidance: () => ipcRenderer.invoke("permissions:get-guidance") as Promise<unknown>,
  getRole: () => ipcRenderer.invoke("app:get-role") as Promise<AppRole>,
  getSampleReportHtml: () => ipcRenderer.invoke("reports:sample-html") as Promise<string>,
  getServerState: () => ipcRenderer.invoke("server:get-state") as Promise<ServerSessionState>,
  getLocalAddresses: () => ipcRenderer.invoke("net:local-addresses") as Promise<string[]>,
  listTestSuites: () => ipcRenderer.invoke("tests:list-suites") as Promise<unknown>,
  setRole: (role: AppRole) => ipcRenderer.invoke("app:set-role", role) as Promise<AppRole>,
  connectToServer: (serverId: string) => ipcRenderer.invoke("client:connect", serverId) as Promise<void>,
  connectToAddress: (address: string) => ipcRenderer.invoke("client:connect-address", address) as Promise<void>,
  runManualTest: () => ipcRenderer.invoke("client:run-iperf") as Promise<void>,
  onServerState: (callback: (state: ServerSessionState) => void) => {
    const listener = (_event: IpcRendererEvent, state: ServerSessionState): void => callback(state);
    ipcRenderer.on("server:state", listener);
    return () => ipcRenderer.removeListener("server:state", listener);
  },
  onClientState: (callback: (state: ClientSessionState) => void) => {
    const listener = (_event: IpcRendererEvent, state: ClientSessionState): void => callback(state);
    ipcRenderer.on("client:state", listener);
    return () => ipcRenderer.removeListener("client:state", listener);
  }
});
