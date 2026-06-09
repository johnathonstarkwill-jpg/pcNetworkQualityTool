import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The Electron smoke test launches the compiled main process (dist/main),
// so compile it before the suite runs. The renderer is served by the Vite
// dev server (configured as the Playwright webServer).
export default function globalSetup(): void {
  execSync("tsc -p tsconfig.node.json", { cwd: appDir, stdio: "inherit" });
}
