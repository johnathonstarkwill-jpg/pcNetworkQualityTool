// Downloads per-platform iperf3 binaries into assets/iperf3/<platform>-<arch>/.
// Idempotent: skips a target that already has the binary. Run before packaging:
//   npm run fetch:iperf3
import { createWriteStream } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

// Pin to known-good upstream archives. Update these URLs when bumping versions.
// Each entry downloads a single ready-to-run binary (no archive extraction) to
// keep the script dependency-free; if upstream only ships archives, download
// the archive here and extract with the platform's tar/unzip via child_process.
const TARGETS = [
  {
    dir: "win32-x64",
    binary: "iperf3.exe",
    url: "https://iperf.fr/download/windows/iperf-3.1.3-win64.exe"
  },
  {
    dir: "darwin-arm64",
    binary: "iperf3",
    url: "https://homebrew.bintray.example/iperf3-darwin-arm64" // replace with a real static build URL
  }
];

const ROOT = path.resolve(import.meta.dirname, "..");

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}

for (const target of TARGETS) {
  const dir = path.join(ROOT, "assets", "iperf3", target.dir);
  const dest = path.join(dir, target.binary);

  if (await exists(dest)) {
    console.log(`skip ${target.dir} (already present)`);
    continue;
  }

  await mkdir(dir, { recursive: true });
  console.log(`downloading ${target.dir} <- ${target.url}`);
  await download(target.url, dest);
  if (!target.binary.endsWith(".exe")) await chmod(dest, 0o755);
  console.log(`done ${target.dir}`);
}

console.log("iperf3 binaries ready");
