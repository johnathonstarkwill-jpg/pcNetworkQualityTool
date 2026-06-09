import { ipcMain } from "electron";
import { ControlClient } from "./controlClient.js";
import { ControlServer } from "./controlServer.js";
import { getPermissionGuidance } from "./permissions.js";
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
  ipcMain.handle("tests:list-suites", () => listTestSuites());

  ipcMain.handle("tests:build-plan", (_event, suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") => {
    return buildTestPlan(suiteId, runMode);
  });
}
