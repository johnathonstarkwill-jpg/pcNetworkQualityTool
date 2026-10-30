import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { createDecoder, encode } from "../../src/main/controlProtocol";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "../..");
const electronBin = path.join(
  appDir,
  process.platform === "darwin"
    ? "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    : "node_modules/electron/dist/electron"
);

// Guards against the preload regression: a sandboxed/ESM-mismatched preload
// loads silently fails, leaving window.networkTool undefined and the whole
// IPC bridge dead. The browser smoke test cannot catch this — only a real
// Electron launch exercises the preload + main process.
test("electron app exposes the IPC bridge and renders suites", async () => {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [appDir],
    cwd: appDir,
    timeout: 30_000
  });

  let socket: net.Socket | undefined;
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Bridge must be present — this is the regression we fixed.
    await expect.poll(() => page.evaluate(() => Boolean(window.networkTool)), { timeout: 15_000 }).toBe(true);

    // Suites come over IPC; verify the renderer actually got them.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("作为服务器"));
      (btn as HTMLButtonElement | undefined)?.click();
    });

    await expect(page.getByText("快速检测")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("长时间稳定性测试")).toBeVisible();
    socket = net.connect(48200, "127.0.0.1");
    await once(socket, "connect");
    const decode = createDecoder();
    let releaseLoad!: () => void;
    const loadReleased = new Promise<void>(resolve => { releaseLoad = resolve; });
    socket.on("data", async data => {
      for (const message of decode(data.toString())) {
        if (message.type !== "start-test") continue;
        for (const phase of message.plan.phases) {
          if (phase.kind.startsWith("tcp") || phase.kind.startsWith("udp")) {
            for (let second = 0; second < 3; second++) socket!.write(encode({ type: "phase-progress", runId: message.runId, clientId: "e2e", phaseId: phase.id,
              interval: { startSeconds: second, endSeconds: second + 1, mbps: second === 1 ? 0 : 10, side: phase.kind.endsWith("download") ? "receiver" : "sender" } }));
          }
          if (phase.kind === "tcp-upload") await loadReleased;
          socket!.write(encode({ type: "phase-result", runId: message.runId, clientId: "e2e", metrics: {
            phaseId: phase.id, throughputMbps: phase.kind.startsWith("tcp") ? 123.456 : undefined,
            ...(phase.kind === "connectivity" ? { reachable: true } : {}),
            ...(phase.kind === "latency" ? { packetsSent: 10, packetsReceived: 9, packetLossPercent: 10, rttSamples: 9, latencyMs: { min: 1, avg: 2, max: 4, p95: 4, p99: 4 } } : {}),
            ...((phase.kind === "udp-quality" || phase.kind === "udp-download") ? { throughputMbps: 7.9, packetsSent: 100, packetsReceived: 99, packetsLost: 1, udpLossPercent: 1, jitterMs: .2 } : {}),
            ...(phase.kind.startsWith("tcp") ? { loadedLatency: { latencyMs: { min: 2, avg: 5, max: 9, p95: 9, p99: 9 }, rttSamples: 3,
              packetsSent: 3, packetsReceived: 3, packetsLost: 0, packetLossPercent: 0, deltaAvgMs: 3, deltaP95Ms: 5, baselineSamples: 9, errors: [], notes: [] } } : {}),
            errors: []
          } }));
        }
        socket!.write(encode({ type: "test-complete", runId: message.runId, clientId: "e2e" }));
      }
    });
    socket.write(encode({ type: "register-client", client: { id: "e2e", name: "数据采集客户端", address: "127.0.0.1", status: "connected" } }));
    await expect(page.locator(".client-list").getByText("数据采集客户端", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /快速检测/ }).click();
    await expect(page.getByRole("heading", { name: "实时吞吐量趋势", exact: true })).toBeVisible();
    await expect(page.locator(".live-trend svg")).toHaveCount(1);
    releaseLoad();
    await expect(page.getByRole("heading", { name: "网络质量测试数据" })).toBeVisible();
    await expect(page.getByText("已完成 6 / 6 个阶段；未完成 0 个阶段。", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "RTT p95/p99 ms", exact: true })).toBeVisible();
    await expect(page.getByText("123.456", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "负载下延迟", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "吞吐稳定性", exact: true })).toBeVisible();
    await expect(page.locator(".measurement-report svg")).toHaveCount(4);
    await expect(page.getByRole("columnheader", { name: "平均 RTT 增量 ms", exact: true })).toBeVisible();
    expect(await page.locator(".report-preview").innerText()).not.toMatch(/优秀|不合格|风险|可用于视频/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/network-data-report.png", fullPage: true });
  } finally {
    socket?.destroy();
    await app.close();
  }
});
