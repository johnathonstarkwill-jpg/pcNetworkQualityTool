// Prepare a pinned build for the current build host; never download a bare Windows EXE.
import { mkdtemp, mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const version = '3.21';
const root = path.resolve(import.meta.dirname, '..');
const dest = path.join(root, 'assets/iperf3', `${process.platform}-${process.arch}`);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'network-iperf-build-'));
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}
await mkdir(dest, { recursive: true });
if (process.platform === 'win32' && process.arch === 'x64') {
  const zip = path.join(temporary, 'iperf.zip');
  await download(`https://github.com/ar51an/iperf3-win-builds/releases/download/${version}/iperf-${version}-win64.zip`, zip);
  execFileSync('tar', ['-xf', zip, '-C', temporary]);
  async function copyBinaries(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await copyBinaries(file);
      else if (/\.(exe|dll)$/i.test(item.name)) await copyFile(file, path.join(dest, item.name));
    }
  }
  await copyBinaries(temporary);
} else if (process.platform === 'darwin') {
  const archive = path.join(temporary, 'source.tar.gz');
  await download(`https://github.com/esnet/iperf/releases/download/${version}/iperf-${version}.tar.gz`, archive);
  execFileSync('tar', ['-xf', archive, '-C', temporary]);
  const cwd = path.join(temporary, `iperf-${version}`);
  execFileSync('./configure', ['--disable-shared', '--enable-static', '--without-openssl'], { cwd, stdio: 'inherit' });
  execFileSync('make', ['-j', '2'], { cwd, stdio: 'inherit' });
  await copyFile(path.join(cwd, 'src/iperf3'), path.join(dest, 'iperf3'));
  execFileSync('codesign', ['--force', '-s', '-', path.join(dest, 'iperf3')]);
} else throw new Error(`Unsupported build host: ${process.platform}-${process.arch}`);
execFileSync(process.execPath, [path.join(root, 'scripts/check-iperf3.mjs')], { stdio: 'inherit' });
