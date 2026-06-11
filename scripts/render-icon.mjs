// Render build/icon.svg -> build/icon.png (1024x1024) with transparent corners.
// Deterministic, headless. Run via `npm run icon`.
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SVG = path.join(ROOT, "build", "icon.svg");
const PNG = path.join(ROOT, "build", "icon.png");

if (!existsSync(SVG)) {
  console.error(`Missing ${SVG}`);
  process.exit(1);
}

const svg = readFileSync(SVG, "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: PNG, omitBackground: true });
  console.log(`Wrote ${PNG}`);
} finally {
  await browser.close();
}
