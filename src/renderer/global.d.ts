import type { AppRole, TestSuiteId } from "../shared/types";

declare global {
  interface Window {
    networkTool: {
      getRole(): Promise<AppRole>;
      setRole(role: AppRole): Promise<AppRole>;
      getServerState(): Promise<unknown>;
      getClientState(): Promise<unknown>;
      getPermissionGuidance(): Promise<{ platform: string; requiresAdminForRepair: boolean; messages: string[] }>;
      getSampleReportHtml(): Promise<string>;
      listTestSuites(): Promise<Array<{ id: TestSuiteId; label: string; description: string }>>;
      buildPlan(suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent"): Promise<unknown>;
    };
  }
}
