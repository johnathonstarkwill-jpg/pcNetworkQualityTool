// REPL driver for the PC Network Quality Tool Electron app.
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
//
// Prerequisites (the app runs in dev mode: main loads the Vite dev server):
//   1. npm run build           # compiles dist/main + dist/renderer
//   2. npm run dev &           # serves renderer at http://127.0.0.1:5173
// Then: node .claude/skills/run-desktop/driver.mjs
import { _electron as electron } from "playwright-core";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "../../..");
const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin =
  process.platform === "darwin"
    ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : path.join(APP_DIR, "node_modules/electron/dist/electron");

let app = null;
let page = null;

const COMMANDS = {
  async launch() {
    if (app) return console.log("already launched");
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR],
      cwd: APP_DIR,
      timeout: 30_000
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_000);
    const bridge = await page.evaluate(() => Boolean(window.networkTool));
    console.log("launched. networkTool bridge:", bridge);
    if (!bridge) console.log("WARN: preload bridge missing — check dist/main/preload.mjs + sandbox:false");
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await page.screenshot({ path: f, fullPage: true });
    console.log("screenshot:", f);
  },

  // DOM click — robust against coordinate/overlay issues.
  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return "NOT_FOUND";
      el.click();
      return "OK";
    }, text);
    console.log("click-text", JSON.stringify(text), "->", r);
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 });
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)", sel || null)
    );
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async quit() {
    // app.close() can hang on macOS; race it against a timeout then force-exit.
    if (app) await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 3_000))]);
    app = null;
    page = null;
  },
  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  }
};

const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "driver> " });

rl.on("line", async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unknown:", cmd, "— try: help");
    return rl.prompt();
  }
  try {
    await fn(rest.join(" "));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
  if (cmd === "quit") {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('network-tool driver — "help" for commands, "launch" to start');
rl.prompt();
