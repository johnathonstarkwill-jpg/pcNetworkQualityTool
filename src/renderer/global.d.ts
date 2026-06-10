import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types";

declare global {
  interface Window {
    networkTool: {
      getRole(): Promise<AppRole>;
      setRole(role: AppRole): Promise<AppRole>;
      getServerState(): Promise<ServerSessionState>;
      getClientState(): Promise<ClientSessionState>;
      getLocalAddresses(): Promise<string[]>;
      getPermissionGuidance(): Promise<{ platform: string; requiresAdminForRepair: boolean; messages: string[] }>;
      getSampleReportHtml(): Promise<string>;
      startTest(suiteId: TestSuiteId): Promise<boolean>;
      getLatestReportHtml(): Promise<string>;
      listTestSuites(): Promise<Array<{ id: TestSuiteId; label: string; description: string }>>;
      buildPlan(suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent"): Promise<unknown>;
      connectToServer(serverId: string): Promise<void>;
      connectToAddress(address: string): Promise<void>;
      runManualTest(): Promise<void>;
      onServerState(callback: (state: ServerSessionState) => void): () => void;
      onClientState(callback: (state: ClientSessionState) => void): () => void;
    };
  }
}
