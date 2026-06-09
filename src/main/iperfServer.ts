import { type ChildProcess, spawn } from "node:child_process";
import { resolveIperfBinary } from "./iperfRunner.js";

export const IPERF_PORT = 5201;

export function buildServerArgs(port: number = IPERF_PORT): string[] {
  return ["-s", "-p", String(port)];
}

export class IperfServer {
  private child: ChildProcess | undefined;

  start(port: number = IPERF_PORT): void {
    if (this.child) return;
    this.child = spawn(resolveIperfBinary(), buildServerArgs(port), { windowsHide: true, stdio: "ignore" });
    // Keep the process from crashing the app if iperf3 writes to a closed pipe.
    this.child.on("error", () => {
      this.child = undefined;
    });
    this.child.on("close", () => {
      this.child = undefined;
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
