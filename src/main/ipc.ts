import { type WebContents, dialog, ipcMain } from "electron";
import { ControlClient } from "./controlClient.js";
import { ControlServer } from "./controlServer.js";
import { DISCOVERY_PORT, DiscoveryBroadcaster, DiscoveryScanner } from "./discovery.js";
import { CONTROL_PORT } from "./controlProtocol.js";
import { IperfServer } from "./iperfServer.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import { getPermissionGuidance } from "./permissions.js";
import { buildReportSummary, renderReportHtml, renderReportMarkdown } from "./reportGenerator.js";
import { buildTestPlan, listTestSuites } from "./testPlans.js";
import type { AppRole, DiscoveredServer, TestSuiteId } from "../shared/types.js";
import { writeFile } from "node:fs/promises";
import os from "node:os";

const server = new ControlServer();
const client = new ControlClient();
const iperfServer = new IperfServer();
let broadcaster: DiscoveryBroadcaster | undefined;
let scanner: DiscoveryScanner | undefined;
let role: AppRole = "unset";

export function registerIpcHandlers(getWebContents: () => WebContents | undefined): void {
  const push = (channel: string, payload: unknown): void => {
    getWebContents()?.send(channel, payload);
  };

  server.on("state", (state) => push("server:state", state));
  client.on("state", (state) => push("client:state", state));

  ipcMain.handle("app:get-role", () => role);

  ipcMain.handle("app:set-role", async (_event, nextRole: AppRole) => {
    role = nextRole;
    await stopNetworking();

    if (nextRole === "server") startServer();
    if (nextRole === "client") startClient();

    return role;
  });

  ipcMain.handle("server:get-state", () => server.getState());
  ipcMain.handle("client:get-state", () => client.getState());
  ipcMain.handle("net:local-addresses", () => listLocalIpv4Addresses());
  ipcMain.handle("permissions:get-guidance", () => getPermissionGuidance());

  ipcMain.handle("client:connect", (_event, serverId: string) => {
    client.connect(serverId);
  });

  ipcMain.handle("client:connect-address", (_event, address: string) => {
    client.connectToAddress(address);
  });

  ipcMain.handle("client:run-iperf", async () => {
    await client.runManualTest();
  });

  ipcMain.handle("tests:list-suites", () => listTestSuites());

  ipcMain.handle("tests:build-plan", (_event, suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") => {
    return buildTestPlan(suiteId, runMode);
  });

  ipcMain.handle("server:start-test", (_event, suiteId: TestSuiteId) => {
    const connectedIds = server
      .getState()
      .clients.filter((c) => c.status === "connected")
      .map((c) => c.id);
    if (connectedIds.length === 0) return false;
    server.startPlan(buildTestPlan(suiteId, "separate"), connectedIds);
    return true;
  });

  ipcMain.handle("reports:latest-html", () => {
    const report = server.getLatestReport();
    return report ? renderReportHtml(report) : "";
  });

  ipcMain.handle("reports:export-markdown", async () => {
    const report = server.getLatestReport();
    if (!report) return { saved: false };

    const markdown = renderReportMarkdown(report, server.getState().log);
    const defaultName = `网络质量测试报告-${report.suiteId}-${timestampForFile(report.createdAt)}.md`;

    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };

    await writeFile(result.filePath, markdown, "utf8");
    return { saved: true, path: result.filePath };
  });

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
}

function startServer(): void {
  const localAddress = listLocalIpv4Addresses()[0] ?? "127.0.0.1";
  server.listen().catch((error: unknown) => {
    console.error("control server failed to listen:", error instanceof Error ? error.message : error);
  });
  iperfServer.start();

  const advertised: Omit<DiscoveredServer, "lastSeenAt"> = {
    id: `server-${os.hostname()}`,
    name: os.hostname(),
    address: localAddress,
    port: CONTROL_PORT
  };
  broadcaster = new DiscoveryBroadcaster(advertised);
  broadcaster.start();
}

function startClient(): void {
  client.clearDiscoveredServers();
  scanner = new DiscoveryScanner();
  scanner.on("server", (discovered: DiscoveredServer) => client.upsertDiscoveredServer(discovered));
  scanner.start();
}

async function stopNetworking(): Promise<void> {
  broadcaster?.stop();
  broadcaster = undefined;
  scanner?.stop();
  scanner = undefined;
  iperfServer.stop();
  client.disconnect();
  await server.close();
}

function timestampForFile(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Exposed so tests / future shutdown hooks can reference the discovery port.
export { DISCOVERY_PORT };
