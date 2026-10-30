import { EventEmitter } from "node:events";
import { type ChildProcess, spawn } from "node:child_process";
import { resolveIperfBinary } from "./iperfRunner.js";

export const IPERF_PORT = 5201;

export function buildServerArgs(port: number = IPERF_PORT): string[] {
  return ["-s", "-p", String(port)];
}

export class IperfServer extends EventEmitter {
  private child: ChildProcess | undefined;

  start(port: number = IPERF_PORT): void {
    if (this.child) return;
    const child = spawn(resolveIperfBinary(), buildServerArgs(port), { windowsHide: true, stdio: "ignore" });
    this.child = child;
    // Keep the process from crashing the app if iperf3 writes to a closed pipe.
    child.on("error", (error) => {
      if (this.child === child) this.child = undefined;
      this.emit("network-error", error);
    });
    child.on("close", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (code !== 0) this.emit("network-error", new Error(`iperf3 退出，代码 ${code}（检查程序文件或 5201 端口占用）`));
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }

  get running(): boolean {
    return this.child !== undefined;
  }
}
