import { execFileSync } from 'node:child_process';
import path from 'node:path';
const binary = path.resolve(import.meta.dirname, '../assets/iperf3', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'iperf3.exe' : 'iperf3');
const output = execFileSync(binary, ['--version'], { encoding: 'utf8' });
const match = output.match(/iperf\s+3\.(\d+)/);
if (!match || Number(match[1]) < 21) throw new Error('iperf3 >= 3.21 required');
if (!execFileSync(binary, ['--help'], { encoding: 'utf8' }).includes('--json-stream')) throw new Error('Missing --json-stream');
if (process.platform === 'darwin') {
  const dependencies = execFileSync('otool', ['-L', binary], { encoding: 'utf8' });
  for (const line of dependencies.split('\n').slice(1).filter(l => l.trim())) {
    if (!/^\s+\/(usr\/lib|System\/Library)\//.test(line)) throw new Error(`Nonportable dependency: ${line}`);
  }
}
console.log('iperf3 preflight passed');
