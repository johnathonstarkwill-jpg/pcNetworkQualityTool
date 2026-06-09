import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
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
  } finally {
    await app.close();
  }
});
