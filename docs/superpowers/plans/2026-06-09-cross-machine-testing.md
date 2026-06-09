# Cross-Machine Testing Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Windows PC and a Mac discover each other, connect over a TCP control channel, sync session state in both UIs, and run a manual cross-machine `iperf3` test; plus produce a macOS `dmg` and a Windows `nsis` installer that bundle the right `iperf3` binary.

**Architecture:** Raw TCP + newline-delimited JSON control channel reusing the existing `ControlMessage` union. The main process owns the network runtime (discovery, control server/client, `iperf3 -s` daemon) and pushes state to the renderer via `webContents.send`. A build script downloads per-platform `iperf3` binaries into `assets/iperf3/<platform>-<arch>/`.

**Tech Stack:** Electron, TypeScript, Node `net`/`dgram`/`child_process`, Vitest, electron-builder.

---

## Source Spec

Implementation follows:

- `docs/superpowers/specs/2026-06-09-cross-machine-testing-design.md`

## File Structure

```text
src/shared/types.ts            [modify] add CONTROL_PORT usage types: extend ClientSessionState/ServerSessionState
src/main/controlProtocol.ts    [create] CONTROL_PORT const + newline-JSON encode/decode
src/main/netInfo.ts            [create] list local IPv4 addresses
src/main/controlServer.ts      [modify] embed net.Server on TCP; map socket -> client
src/main/controlClient.ts      [modify] net.Socket connect/register/receive; manual iperf run
src/main/iperfServer.ts        [create] start/stop iperf3 -s daemon
src/main/iperfRunner.ts        [modify] fix resolveIperfBinary for packaged app
src/main/ipc.ts                [modify] new handlers + push state to renderer
src/main/main.ts               [modify] pass mainWindow webContents to ipc for push
src/main/preload.mts           [modify] expose new methods + state subscriptions
src/renderer/global.d.ts       [modify] type the new bridge methods
src/renderer/App.tsx           [modify] wire server + client screens to live state
scripts/fetch-iperf3.mjs       [create] download per-platform iperf3 binaries
package.json                   [modify] add fetch:iperf3 script
tests/unit/controlProtocol.test.ts   [create]
tests/unit/controlChannel.test.ts    [create] loopback server+client integration
tests/unit/iperfServer.test.ts       [create]
docs/two-machine-verification.md     [create] manual checklist
```

Responsibilities:

- `controlProtocol.ts`: pure serialization + a streaming decoder. No sockets.
- `netInfo.ts`: local IPv4 discovery for display + client identity.
- `controlServer.ts`: TCP listener + client/socket registry + state events.
- `controlClient.ts`: TCP connection, registration, manual iperf run + state events.
- `iperfServer.ts`: lifecycle of the `iperf3 -s` daemon.
- `ipc.ts`: bridge between renderer and the network runtime, with push state.

---

## Task 1: Control Protocol (encode / streaming decode)

**Files:**
- Create: `src/main/controlProtocol.ts`
- Test: `tests/unit/controlProtocol.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/controlProtocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONTROL_PORT, createDecoder, encode } from "../../src/main/controlProtocol";
import type { ControlMessage } from "../../src/shared/types";

describe("controlProtocol", () => {
  it("exposes the fixed control port", () => {
    expect(CONTROL_PORT).toBe(48200);
  });

  it("encodes a message as one JSON line ending in newline", () => {
    const msg: ControlMessage = { type: "client-registered", clientId: "c1" };
    expect(encode(msg)).toBe('{"type":"client-registered","clientId":"c1"}\n');
  });

  it("decodes a single complete frame", () => {
    const decode = createDecoder();
    const msgs = decode('{"type":"client-registered","clientId":"c1"}\n');
    expect(msgs).toEqual([{ type: "client-registered", clientId: "c1" }]);
  });

  it("buffers a partial frame until the newline arrives", () => {
    const decode = createDecoder();
    expect(decode('{"type":"test-complete",')).toEqual([]);
    expect(decode('"clientId":"c1"}\n')).toEqual([{ type: "test-complete", clientId: "c1" }]);
  });

  it("decodes multiple coalesced frames in one chunk", () => {
    const decode = createDecoder();
    const chunk = '{"type":"error","message":"a"}\n{"type":"error","message":"b"}\n';
    expect(decode(chunk)).toEqual([
      { type: "error", message: "a" },
      { type: "error", message: "b" }
    ]);
  });

  it("discards malformed lines without throwing", () => {
    const decode = createDecoder();
    expect(decode('not json\n{"type":"error","message":"ok"}\n')).toEqual([
      { type: "error", message: "ok" }
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/unit/controlProtocol.test.ts`
Expected: FAIL — `src/main/controlProtocol.ts` does not exist.

- [ ] **Step 3: Implement the protocol**

Write `src/main/controlProtocol.ts`:

```ts
import type { ControlMessage } from "../shared/types.js";

export const CONTROL_PORT = 48200;

export function encode(message: ControlMessage): string {
  return `${JSON.stringify(message)}\n`;
}

// Returns a stateful decoder. Feed it raw socket chunks (strings); it returns
// the complete ControlMessages parsed so far, buffering any partial trailing
// line and silently discarding malformed lines.
export function createDecoder(): (chunk: string) => ControlMessage[] {
  let buffer = "";

  return (chunk: string): ControlMessage[] => {
    buffer += chunk;
    const messages: ControlMessage[] = [];
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim().length > 0) {
        try {
          messages.push(JSON.parse(line) as ControlMessage);
        } catch {
          // Drop malformed frame; a real logger would record it here.
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    return messages;
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/controlProtocol.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/controlProtocol.ts tests/unit/controlProtocol.test.ts
git commit -m "feat: add control channel wire protocol"
```

---

## Task 2: Shared Type Extensions

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Extend session state types**

In `src/shared/types.ts`, replace the `ServerSessionState` and `ClientSessionState` interfaces (currently at the end of the file) with:

```ts
export interface ServerSessionState {
  role: "server";
  clients: ConnectedClient[];
  activePlan?: TestPlan;
  latestReport?: TestReport;
  listening: boolean;
  localAddresses: string[];
}

export interface ClientSessionState {
  role: "client";
  discoveredServers: DiscoveredServer[];
  connectedServer?: DiscoveredServer;
  status: "searching" | "connecting" | "connected" | "testing" | "error";
  statusText: string;
  lastResult?: PhaseMetrics[];
}
```

- [ ] **Step 2: Run typecheck to find the call sites that must adapt**

Run: `npm run build`
Expected: FAIL — `controlServer.ts` and `controlClient.ts` `getState()` do not yet return the new required fields (`listening`, `localAddresses`). These are fixed in Tasks 3 and 4. This failure is expected; do not commit yet.

- [ ] **Step 3: Commit the type change together with Task 3**

Do not commit standalone — committed at the end of Task 3 once `getState()` compiles.

---

## Task 3: TCP Control Server

**Files:**
- Modify: `src/main/controlServer.ts`
- Create: `src/main/netInfo.ts`

- [ ] **Step 1: Create the local-address helper**

Write `src/main/netInfo.ts`:

```ts
import os from "node:os";

// Non-internal IPv4 addresses of this machine, shown to the operator so the
// other machine can connect by manual IP, and used as the client's address.
export function listLocalIpv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item): item is os.NetworkInterfaceInfo => item !== undefined && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
```

- [ ] **Step 2: Write a failing integration test for the server registry**

Write `tests/unit/controlChannel.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { encode } from "../../src/main/controlProtocol";
import { ControlServer } from "../../src/main/controlServer";
import net from "node:net";

let server: ControlServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("ControlServer over TCP", () => {
  it("registers a client that connects and sends register-client", async () => {
    server = new ControlServer();
    const port = await server.listen(0); // 0 => ephemeral port

    const stateAfterRegister = new Promise((resolve) => {
      server!.on("state", (state) => {
        if (state.clients.length === 1) resolve(state);
      });
    });

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      encode({
        type: "register-client",
        client: { id: "c1", name: "客户端 A", address: "127.0.0.1", status: "connected" }
      })
    );

    const state: any = await stateAfterRegister;
    expect(state.clients[0]).toMatchObject({ id: "c1", name: "客户端 A", status: "connected" });

    const ackLine = await new Promise<string>((resolve) => socket.once("data", (d) => resolve(d.toString())));
    expect(JSON.parse(ackLine.trim())).toEqual({ type: "client-registered", clientId: "c1" });

    socket.destroy();
  });

  it("marks a client disconnected when its socket closes", async () => {
    server = new ControlServer();
    const port = await server.listen(0);

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      encode({
        type: "register-client",
        client: { id: "c2", name: "客户端 B", address: "127.0.0.1", status: "connected" }
      })
    );
    await new Promise((resolve) => socket.once("data", resolve));

    const disconnected = new Promise((resolve) => {
      server!.on("state", (state) => {
        if (state.clients[0]?.status === "disconnected") resolve(state);
      });
    });

    socket.destroy();
    const state: any = await disconnected;
    expect(state.clients[0].status).toBe("disconnected");
  });
});
```

- [ ] **Step 3: Run the test to verify failure**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: FAIL — `ControlServer.listen` / TCP behavior not implemented.

- [ ] **Step 4: Implement the TCP server**

Replace the entire contents of `src/main/controlServer.ts` with:

```ts
import { EventEmitter } from "node:events";
import net from "node:net";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type { ConnectedClient, ControlMessage, ServerSessionState, TestPlan } from "../shared/types.js";

export class ControlServer extends EventEmitter {
  private activePlan: TestPlan | undefined;
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly sockets = new Map<string, net.Socket>();
  private netServer: net.Server | undefined;
  private listening = false;

  getState(): ServerSessionState {
    return {
      role: "server",
      clients: [...this.clients.values()],
      activePlan: this.activePlan,
      listening: this.listening,
      localAddresses: listLocalIpv4Addresses()
    };
  }

  // Resolves with the actual bound port (useful when passing 0 in tests).
  listen(port: number = CONTROL_PORT): Promise<number> {
    return new Promise((resolve, reject) => {
      const netServer = net.createServer((socket) => this.handleConnection(socket));
      netServer.on("error", reject);
      netServer.listen(port, () => {
        this.netServer = netServer;
        this.listening = true;
        const address = netServer.address();
        const boundPort = typeof address === "object" && address ? address.port : port;
        this.emit("state", this.getState());
        resolve(boundPort);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.sockets.values()) socket.destroy();
      this.sockets.clear();
      this.listening = false;

      if (!this.netServer) {
        resolve();
        return;
      }

      this.netServer.close(() => {
        this.netServer = undefined;
        this.emit("state", this.getState());
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    const decode = createDecoder();
    let clientId: string | undefined;

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "register-client") {
          clientId = message.client.id;
          this.sockets.set(clientId, socket);
          this.registerClient(message.client);
          socket.write(encode({ type: "client-registered", clientId }));
        }
      }
    });

    const drop = (): void => {
      if (clientId) this.markClientDisconnected(clientId);
      if (clientId) this.sockets.delete(clientId);
    };
    socket.on("close", drop);
    socket.on("error", drop);
  }

  registerClient(client: ConnectedClient): void {
    this.clients.set(client.id, { ...client, status: "connected" });
    this.emit("state", this.getState());
  }

  markClientDisconnected(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.clients.set(clientId, { ...client, status: "disconnected" });
    this.emit("state", this.getState());
  }

  broadcast(message: ControlMessage): void {
    const line = encode(message);
    for (const socket of this.sockets.values()) socket.write(line);
  }
}
```

- [ ] **Step 5: Run the tests to verify pass**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: still FAILS only in `controlClient.ts` (its `getState()` lacks `lastResult` handling is fine, but it must still compile). If `controlClient.ts` already compiles, build passes. If it fails on `ClientSessionState`, that is fixed in Task 4. Proceed to commit only the server-side files.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/controlProtocol.ts src/main/netInfo.ts src/main/controlServer.ts tests/unit/controlChannel.test.ts
git commit -m "feat: add TCP control server with client registry"
```

---

## Task 4: TCP Control Client + Manual iperf Run

**Files:**
- Modify: `src/main/controlClient.ts`

- [ ] **Step 1: Add a failing client connection test**

Append to `tests/unit/controlChannel.test.ts` (inside the file, after the existing `describe`):

```ts
import { ControlClient } from "../../src/main/controlClient";

describe("ControlClient over TCP", () => {
  it("connects to a server and reaches connected status", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const client = new ControlClient();
    const connected = new Promise((resolve) => {
      client.on("state", (state) => {
        if (state.status === "connected") resolve(state);
      });
    });

    client.connectToAddress("127.0.0.1", port);
    const state: any = await connected;
    expect(state.status).toBe("connected");
    expect(state.connectedServer?.address).toBe("127.0.0.1");

    client.disconnect();
    await srv.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: FAIL — `ControlClient.connectToAddress` / `disconnect` not implemented.

- [ ] **Step 3: Implement the TCP client**

Replace the entire contents of `src/main/controlClient.ts` with:

```ts
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import { CONTROL_PORT, createDecoder, encode } from "./controlProtocol.js";
import { runIperf } from "./iperfRunner.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import type { ClientSessionState, ConnectedClient, DiscoveredServer, PhaseMetrics } from "../shared/types.js";

export class ControlClient extends EventEmitter {
  private connectedServer: DiscoveredServer | undefined;
  private readonly discoveredServers = new Map<string, DiscoveredServer>();
  private status: ClientSessionState["status"] = "searching";
  private statusText = "正在搜索服务器";
  private lastResult: PhaseMetrics[] | undefined;
  private socket: net.Socket | undefined;
  private readonly identity: ConnectedClient = {
    id: `client-${os.hostname()}-${process.pid}`,
    name: os.hostname(),
    address: listLocalIpv4Addresses()[0] ?? "127.0.0.1",
    status: "connected"
  };

  getState(): ClientSessionState {
    return {
      role: "client",
      discoveredServers: [...this.discoveredServers.values()],
      connectedServer: this.connectedServer,
      status: this.status,
      statusText: this.statusText,
      lastResult: this.lastResult
    };
  }

  upsertDiscoveredServer(server: DiscoveredServer): void {
    this.discoveredServers.set(server.id, server);
    if (this.status === "searching") this.statusText = "已发现服务器";
    this.emit("state", this.getState());
  }

  connect(serverId: string): void {
    const server = this.discoveredServers.get(serverId);
    if (!server) {
      this.fail("无法连接，请检查是否在同一网络");
      return;
    }
    this.connectToAddress(server.address, server.port, server);
  }

  connectToAddress(address: string, port: number = CONTROL_PORT, server?: DiscoveredServer): void {
    this.disconnect();
    this.status = "connecting";
    this.statusText = "正在连接服务器";
    this.connectedServer = server ?? {
      id: `manual-${address}`,
      name: address,
      address,
      port,
      lastSeenAt: Date.now()
    };
    this.emit("state", this.getState());

    const decode = createDecoder();
    const socket = net.connect(port, address);
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      socket.write(encode({ type: "register-client", client: this.identity }));
    });

    socket.on("data", (chunk: string) => {
      for (const message of decode(chunk)) {
        if (message.type === "client-registered") {
          this.status = "connected";
          this.statusText = "已连接，等待服务器开始测试";
          this.emit("state", this.getState());
        }
      }
    });

    socket.on("error", () => this.fail("连接失败，请检查服务器 IP 与防火墙设置"));
    socket.on("close", () => {
      if (this.status === "connected") {
        this.status = "error";
        this.statusText = "与服务器的连接已断开";
        this.emit("state", this.getState());
      }
    });
  }

  // Manual cross-machine test: one short TCP-upload + one UDP-quality run
  // against the connected server. Returns nothing; results land in state.
  async runManualTest(): Promise<void> {
    const host = this.connectedServer?.address;
    if (!host) {
      this.fail("尚未连接服务器，无法测试");
      return;
    }

    this.status = "testing";
    this.statusText = "正在测试网络质量";
    this.emit("state", this.getState());

    try {
      const tcp = await runIperf({ host, phaseKind: "tcp-upload", durationSeconds: 5 });
      const udp = await runIperf({ host, phaseKind: "udp-quality", durationSeconds: 5, targetBitrateMbps: 10 });
      this.lastResult = [tcp, udp];
      this.status = "connected";
      this.statusText = "测试完成";
    } catch (error: unknown) {
      this.status = "error";
      this.statusText = error instanceof Error ? `测试失败：${error.message}` : "测试失败";
    }
    this.emit("state", this.getState());
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  private fail(text: string): void {
    this.status = "error";
    this.statusText = text;
    this.emit("state", this.getState());
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: PASS (3 tests total in this file).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: PASS (all shared-type call sites now satisfied).

- [ ] **Step 6: Commit**

```bash
git add src/main/controlClient.ts tests/unit/controlChannel.test.ts
git commit -m "feat: add TCP control client and manual iperf run"
```

---

## Task 5: iperf3 Server Daemon

**Files:**
- Create: `src/main/iperfServer.ts`
- Test: `tests/unit/iperfServer.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/iperfServer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServerArgs } from "../../src/main/iperfServer";

describe("iperfServer", () => {
  it("builds default server args binding all interfaces on the iperf3 port", () => {
    expect(buildServerArgs()).toEqual(["-s", "-p", "5201"]);
  });

  it("accepts a custom port", () => {
    expect(buildServerArgs(5202)).toEqual(["-s", "-p", "5202"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/unit/iperfServer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the daemon controller**

Write `src/main/iperfServer.ts`:

```ts
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
    this.child = spawn(resolveIperfBinary(), buildServerArgs(port), { windowsHide: true });
    // Keep the process from crashing the app if iperf3 writes to a closed pipe.
    this.child.on("error", () => {
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/unit/iperfServer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/iperfServer.ts tests/unit/iperfServer.test.ts
git commit -m "feat: add iperf3 server daemon controller"
```

---

## Task 6: Fix iperf binary resolution for packaged app

**Files:**
- Modify: `src/main/iperfRunner.ts`

- [ ] **Step 1: Read the current resolver**

Open `src/main/iperfRunner.ts` and find `resolveIperfBinary()`. It currently joins a path relative to `__dirname` and `../../assets/iperf3`, which is correct in dev but wrong in a packaged app where binaries live under `process.resourcesPath/iperf3`.

- [ ] **Step 2: Replace the resolver**

Replace the `resolveIperfBinary` function in `src/main/iperfRunner.ts` with:

```ts
export function resolveIperfBinary(): string {
  const platformDir = `${process.platform}-${process.arch}`;
  const binaryName = process.platform === "win32" ? "iperf3.exe" : "iperf3";

  // In a packaged Electron app, extraResources land in process.resourcesPath.
  // electron-builder maps assets/iperf3 -> <resources>/iperf3.
  const isPackaged = Boolean(process.resourcesPath) && __dirname.includes("app.asar");
  const baseDir = isPackaged
    ? path.join(process.resourcesPath, "iperf3")
    : path.join(__dirname, "../../assets/iperf3");

  return path.join(baseDir, platformDir, binaryName);
}
```

Ensure `import path from "node:path";` already exists at the top of the file (it does — used by the existing resolver). No new imports needed.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Run the full unit suite (no regressions)**

Run: `npm test`
Expected: PASS — all existing + new unit tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/iperfRunner.ts
git commit -m "fix: resolve bundled iperf3 path in packaged app"
```

---

## Task 7: IPC Wiring with Push State

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Rewrite ipc.ts to own the network runtime and push state**

Replace the entire contents of `src/main/ipc.ts` with:

```ts
import { type WebContents, ipcMain } from "electron";
import { ControlClient } from "./controlClient.js";
import { ControlServer } from "./controlServer.js";
import { DISCOVERY_PORT, DiscoveryBroadcaster, DiscoveryScanner } from "./discovery.js";
import { IperfServer } from "./iperfServer.js";
import { listLocalIpv4Addresses } from "./netInfo.js";
import { getPermissionGuidance } from "./permissions.js";
import { buildReportSummary, renderReportHtml } from "./reportGenerator.js";
import { buildTestPlan, listTestSuites } from "./testPlans.js";
import type { AppRole, DiscoveredServer, TestSuiteId } from "../shared/types.js";
import os from "node:os";

const server = new ControlServer();
const client = new ControlClient();
const iperfServer = new IperfServer();
let broadcaster: DiscoveryBroadcaster | undefined;
let scanner: DiscoveryScanner | undefined;
let role: AppRole = "unset";

export function registerIpcHandlers(getWebContents: () => WebContents | undefined): void {
  const push = (channel: string, payload: unknown): void => {
    getWebContents()?.send(channel, payload);
  };

  server.on("state", (state) => push("server:state", state));
  client.on("state", (state) => push("client:state", state));

  ipcMain.handle("app:get-role", () => role);

  ipcMain.handle("app:set-role", (_event, nextRole: AppRole) => {
    role = nextRole;
    stopNetworking();

    if (nextRole === "server") startServer();
    if (nextRole === "client") startClient();

    return role;
  });

  ipcMain.handle("server:get-state", () => server.getState());
  ipcMain.handle("client:get-state", () => client.getState());
  ipcMain.handle("net:local-addresses", () => listLocalIpv4Addresses());
  ipcMain.handle("permissions:get-guidance", () => getPermissionGuidance());

  ipcMain.handle("client:connect", (_event, serverId: string) => {
    client.connect(serverId);
  });

  ipcMain.handle("client:connect-address", (_event, address: string) => {
    client.connectToAddress(address);
  });

  ipcMain.handle("client:run-iperf", async () => {
    await client.runManualTest();
  });

  ipcMain.handle("tests:list-suites", () => listTestSuites());

  ipcMain.handle("tests:build-plan", (_event, suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") => {
    return buildTestPlan(suiteId, runMode);
  });

  ipcMain.handle("reports:sample-html", () => {
    const results = [
      {
        clientId: "client-a",
        clientName: "客户端 A",
        phases: [{ phaseId: "udp-quality", udpLossPercent: 0.2, jitterMs: 8, throughputMbps: 92, errors: [] }]
      }
    ];

    return renderReportHtml({
      id: "sample",
      createdAt: new Date().toISOString(),
      suiteId: "quick-check",
      serverName: "测试服务器",
      serverAddress: "192.168.1.10",
      clients: [{ id: "client-a", name: "客户端 A", address: "192.168.1.11", status: "connected" }],
      results,
      summary: buildReportSummary(results)
    });
  });
}

function startServer(): void {
  const localAddress = listLocalIpv4Addresses()[0] ?? "127.0.0.1";
  void server.listen();
  iperfServer.start();

  const advertised: Omit<DiscoveredServer, "lastSeenAt"> = {
    id: `server-${os.hostname()}`,
    name: os.hostname(),
    address: localAddress,
    port: 48200
  };
  broadcaster = new DiscoveryBroadcaster(advertised);
  broadcaster.start();
}

function startClient(): void {
  scanner = new DiscoveryScanner();
  scanner.on("server", (discovered: DiscoveredServer) => client.upsertDiscoveredServer(discovered));
  scanner.start();
}

function stopNetworking(): void {
  broadcaster?.stop();
  broadcaster = undefined;
  scanner?.stop();
  scanner = undefined;
  iperfServer.stop();
  client.disconnect();
  void server.close();
}

// Exposed so tests / future shutdown hooks can reference the discovery port.
export { DISCOVERY_PORT };
```

- [ ] **Step 2: Update main.ts to pass the window's webContents**

Replace the entire contents of `src/main/main.ts` with:

```ts
import { app, BrowserWindow } from "electron";
import isDev from "electron-is-dev";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | undefined;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "PC Network Quality Tool",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

registerIpcHandlers(() => mainWindow?.webContents);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Run unit suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/main.ts
git commit -m "feat: wire network runtime through IPC with push state"
```

---

## Task 8: Preload + Renderer Types

**Files:**
- Modify: `src/main/preload.mts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Expose new methods and state subscriptions in preload**

Replace the entire contents of `src/main/preload.mts` with:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types.js";

contextBridge.exposeInMainWorld("networkTool", {
  buildPlan: (suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent") =>
    ipcRenderer.invoke("tests:build-plan", suiteId, runMode),
  getClientState: () => ipcRenderer.invoke("client:get-state") as Promise<ClientSessionState>,
  getPermissionGuidance: () => ipcRenderer.invoke("permissions:get-guidance") as Promise<unknown>,
  getRole: () => ipcRenderer.invoke("app:get-role") as Promise<AppRole>,
  getSampleReportHtml: () => ipcRenderer.invoke("reports:sample-html") as Promise<string>,
  getServerState: () => ipcRenderer.invoke("server:get-state") as Promise<ServerSessionState>,
  getLocalAddresses: () => ipcRenderer.invoke("net:local-addresses") as Promise<string[]>,
  listTestSuites: () => ipcRenderer.invoke("tests:list-suites") as Promise<unknown>,
  setRole: (role: AppRole) => ipcRenderer.invoke("app:set-role", role) as Promise<AppRole>,
  connectToServer: (serverId: string) => ipcRenderer.invoke("client:connect", serverId) as Promise<void>,
  connectToAddress: (address: string) => ipcRenderer.invoke("client:connect-address", address) as Promise<void>,
  runManualTest: () => ipcRenderer.invoke("client:run-iperf") as Promise<void>,
  onServerState: (callback: (state: ServerSessionState) => void) => {
    const listener = (_event: unknown, state: ServerSessionState): void => callback(state);
    ipcRenderer.on("server:state", listener);
    return () => ipcRenderer.removeListener("server:state", listener);
  },
  onClientState: (callback: (state: ClientSessionState) => void) => {
    const listener = (_event: unknown, state: ClientSessionState): void => callback(state);
    ipcRenderer.on("client:state", listener);
    return () => ipcRenderer.removeListener("client:state", listener);
  }
});
```

- [ ] **Step 2: Type the bridge in global.d.ts**

Replace the entire contents of `src/renderer/global.d.ts` with:

```ts
import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types";

declare global {
  interface Window {
    networkTool: {
      getRole(): Promise<AppRole>;
      setRole(role: AppRole): Promise<AppRole>;
      getServerState(): Promise<ServerSessionState>;
      getClientState(): Promise<ClientSessionState>;
      getLocalAddresses(): Promise<string[]>;
      getPermissionGuidance(): Promise<{ platform: string; requiresAdminForRepair: boolean; messages: string[] }>;
      getSampleReportHtml(): Promise<string>;
      listTestSuites(): Promise<Array<{ id: TestSuiteId; label: string; description: string }>>;
      buildPlan(suiteId: TestSuiteId, runMode: "single" | "separate" | "concurrent"): Promise<unknown>;
      connectToServer(serverId: string): Promise<void>;
      connectToAddress(address: string): Promise<void>;
      runManualTest(): Promise<void>;
      onServerState(callback: (state: ServerSessionState) => void): () => void;
      onClientState(callback: (state: ClientSessionState) => void): () => void;
    };
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.mts src/renderer/global.d.ts
git commit -m "feat: expose network runtime bridge to renderer"
```

---

## Task 9: Renderer UI Wiring

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Rewrite App.tsx with live server/client screens**

Replace the entire contents of `src/renderer/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import type { AppRole, ClientSessionState, ServerSessionState, TestSuiteId } from "../shared/types";

interface SuiteView {
  id: TestSuiteId;
  label: string;
  description: string;
}

export function App() {
  const [role, setRoleState] = useState<AppRole>("unset");
  const [suites, setSuites] = useState<SuiteView[]>([]);

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getRole().then(setRoleState);
    void window.networkTool.listTestSuites().then((value) => setSuites(value as SuiteView[]));
  }, []);

  async function setRole(nextRole: AppRole) {
    if (!window.networkTool) {
      setRoleState(nextRole);
      return;
    }
    const savedRole = await window.networkTool.setRole(nextRole);
    setRoleState(savedRole);
  }

  if (role === "server") {
    return <ServerScreen suites={suites} onBack={() => void setRole("unset")} />;
  }

  if (role === "client") {
    return <ClientScreen onBack={() => void setRole("unset")} />;
  }

  return (
    <main className="app-shell">
      <section className="role-panel">
        <h1>网络质量测试工具</h1>
        <p>请选择这台电脑在本次测试中的角色。</p>
        <div className="role-actions">
          <button type="button" onClick={() => void setRole("server")}>
            作为服务器
          </button>
          <button type="button" onClick={() => void setRole("client")}>
            作为客户端
          </button>
        </div>
      </section>
    </main>
  );
}

function ServerScreen({ suites, onBack }: { suites: SuiteView[]; onBack: () => void }) {
  const [state, setState] = useState<ServerSessionState | undefined>(undefined);
  const [reportHtml, setReportHtml] = useState<string>("");

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getServerState().then(setState);
    return window.networkTool.onServerState(setState);
  }, []);

  async function previewReport() {
    setReportHtml(await window.networkTool.getSampleReportHtml());
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>服务器模式</h1>
          <p>请把下面的 IP 告诉客户端电脑，或等待自动发现。</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>本机地址</h2>
          {state && state.localAddresses.length > 0 ? (
            <ul className="address-list">
              {state.localAddresses.map((address) => (
                <li key={address}>{address}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">未检测到本地网络地址</p>
          )}
          <h2>已连接客户端</h2>
          {state && state.clients.length > 0 ? (
            <ul className="client-list">
              {state.clients.map((c) => (
                <li key={c.id}>
                  {c.name}（{c.address}）— {c.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无客户端连接</p>
          )}
        </div>
        <div className="panel">
          <h2>测试套件</h2>
          <div className="suite-list">
            {suites.map((suite) => (
              <button key={suite.id} type="button" className="suite-button">
                <strong>{suite.label}</strong>
                <span>{suite.description}</span>
              </button>
            ))}
          </div>
          <button type="button" className="secondary" onClick={() => void previewReport()}>
            预览报告
          </button>
          {reportHtml ? <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} /> : null}
        </div>
      </section>
    </main>
  );
}

function ClientScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<ClientSessionState | undefined>(undefined);
  const [manualIp, setManualIp] = useState<string>("");

  useEffect(() => {
    if (!window.networkTool) return;
    void window.networkTool.getClientState().then(setState);
    return window.networkTool.onClientState(setState);
  }, []);

  const connected = state?.status === "connected" || state?.status === "testing";

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>客户端模式</h1>
          <p>{state?.statusText ?? "正在搜索测试服务器。"}</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>
          返回
        </button>
      </header>
      <section className="panel">
        <h2>服务器搜索</h2>
        {state && state.discoveredServers.length > 0 ? (
          <ul className="server-list">
            {state.discoveredServers.map((srv) => (
              <li key={srv.id}>
                <button type="button" className="suite-button" onClick={() => void window.networkTool.connectToServer(srv.id)}>
                  <strong>{srv.name}</strong>
                  <span>{srv.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">正在搜索服务器。如果长时间没有结果，请使用手动 IP 连接。</p>
        )}
        <label className="manual-ip">
          手动输入服务器 IP
          <input
            type="text"
            placeholder="例如 192.168.1.23"
            value={manualIp}
            onChange={(event) => setManualIp(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void window.networkTool.connectToAddress(manualIp)}
          disabled={manualIp.trim().length === 0}
        >
          连接
        </button>

        {connected ? (
          <div className="test-block">
            <button type="button" onClick={() => void window.networkTool.runManualTest()} disabled={state?.status === "testing"}>
              {state?.status === "testing" ? "测试中…" : "测试到服务器"}
            </button>
            {state?.lastResult ? (
              <table className="result-table">
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>吞吐量 Mbps</th>
                    <th>UDP 丢包 %</th>
                    <th>抖动 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lastResult.map((phase) => (
                    <tr key={phase.phaseId}>
                      <td>{phase.phaseId}</td>
                      <td>{format(phase.throughputMbps)}</td>
                      <td>{format(phase.udpLossPercent)}</td>
                      <td>{format(phase.jitterMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function format(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}
```

- [ ] **Step 2: Add styles for the new lists and result table**

Append to `src/renderer/styles.css`:

```css
.address-list,
.client-list,
.server-list {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: grid;
  gap: 8px;
}

.address-list li {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 18px;
}

.client-list li,
.server-list li {
  font-size: 16px;
}

.test-block {
  margin-top: 24px;
  display: grid;
  gap: 16px;
}

.result-table {
  border-collapse: collapse;
  width: 100%;
}

.result-table th,
.result-table td {
  border: 1px solid #d9e2e8;
  padding: 8px;
  text-align: left;
}

.result-table th {
  background: #eef3f6;
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Update the Electron smoke test for the new server copy**

The existing `tests/e2e/electron.spec.ts` clicks `作为服务器` and asserts suites render. Selecting the server role now starts real networking (TCP listen, iperf3 spawn). The suite list still renders, so the assertion holds. Verify it still passes:

Run: `npm run e2e`
Expected: PASS (2 tests). If the iperf3 binary is absent, the daemon spawn errors are swallowed by `IperfServer` (`child.on("error")`), so the UI is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: wire server and client screens to live network state"
```

---

## Task 10: iperf3 Fetch Script + Build Config

**Files:**
- Create: `scripts/fetch-iperf3.mjs`
- Modify: `package.json`
- Modify: `assets/iperf3/README.md`

- [ ] **Step 1: Write the fetch script**

Write `scripts/fetch-iperf3.mjs`:

```js
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
```

> Note: the `darwin-arm64` URL above is a placeholder for a real static macOS
> `iperf3` build. Before running on Mac, replace it with a working URL (e.g. a
> static build you host, or extract from Homebrew bottle). The Windows URL is a
> real upstream `.exe`. If a target's URL is not yet valid, the script errors on
> that target — fix the URL and re-run; already-downloaded targets are skipped.

- [ ] **Step 2: Add the npm script**

In `package.json`, add to the `scripts` block (after `"dist"`):

```json
"fetch:iperf3": "node scripts/fetch-iperf3.mjs"
```

- [ ] **Step 3: Update the binary placement note**

Replace the contents of `assets/iperf3/README.md` with:

```md
# iperf3 binaries

These are downloaded by `npm run fetch:iperf3` into platform folders:

- `win32-x64/iperf3.exe`
- `darwin-arm64/iperf3`
- `darwin-x64/iperf3` (optional, for Intel Macs)

The application resolves the binary by platform and architecture at runtime
(`resolveIperfBinary` in `src/main/iperfRunner.ts`). In a packaged app they are
bundled as extraResources under `<resources>/iperf3/`.

Run `npm run fetch:iperf3` once on each build machine before `npm run dist`.
```

- [ ] **Step 4: Verify the script runs (downloads the Windows binary)**

Run: `npm run fetch:iperf3`
Expected: downloads `win32-x64/iperf3.exe`; the `darwin-arm64` target errors only if its placeholder URL is unresolved — that is acceptable until the real URL is filled in. Confirm `assets/iperf3/win32-x64/iperf3.exe` exists.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-iperf3.mjs package.json assets/iperf3/README.md
git commit -m "build: add iperf3 binary fetch script"
```

---

## Task 11: Manual Two-Machine Verification Checklist

**Files:**
- Create: `docs/two-machine-verification.md`

- [ ] **Step 1: Write the verification checklist**

Write `docs/two-machine-verification.md`:

```md
# Two-Machine Verification (Windows + Mac)

Prerequisites:
- Both machines on the same LAN / subnet.
- iperf3 binaries fetched (`npm run fetch:iperf3`) and app built (`npm run build`).
- Firewall: allow the app when the OS prompts (Windows Defender / macOS local network).

## Steps

1. **Mac (server):** launch the app, choose 作为服务器.
   - Expect: 本机地址 lists the Mac's LAN IPv4 (e.g. 192.168.x.y).
   - Expect: an `iperf3 -s` process is running.
2. **Windows (client):** launch the app, choose 作为客户端.
   - Expect: the Mac server appears in 服务器搜索 within a few seconds (auto-discovery),
     OR type the Mac IP into 手动输入服务器 IP and click 连接.
3. **Windows:** confirm status becomes 已连接，等待服务器开始测试.
4. **Mac:** confirm the Windows client appears under 已连接客户端 with status connected.
5. **Windows:** click 测试到服务器.
   - Expect: status 测试中…, then a result table with TCP throughput (Mbps),
     UDP loss (%), and jitter (ms).
6. **Reverse roles** (Windows server, Mac client) and repeat steps 1–5.

## Pass criteria

- Discovery OR manual-IP connect works in at least one direction.
- Both UIs reflect the connection.
- A manual iperf run produces non-empty throughput and a loss/jitter value.

## Troubleshooting

- No discovery: UDP broadcast may be blocked — use manual IP.
- Connect fails: check the firewall prompt was allowed and both machines are on
  the same subnet.
- iperf result empty / error: confirm `iperf3 -s` is running on the server and
  the bundled binary exists for the client's platform.
```

- [ ] **Step 2: Commit**

```bash
git add docs/two-machine-verification.md
git commit -m "docs: add two-machine verification checklist"
```

---

## Task 12: Full Verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS — controlProtocol, controlChannel, iperfServer, plus existing discovery/iperfParser/reportGenerator/testPlans.

- [ ] **Step 2: Run the e2e smoke suite**

Run: `npm run e2e`
Expected: PASS (browser smoke + electron bridge smoke).

- [ ] **Step 3: Build a local package (Mac)**

Run: `npm run fetch:iperf3 && npm run package`
Expected: build succeeds; `release/mac-arm64/PC Network Quality Tool.app` exists with `Contents/Resources/iperf3/darwin-arm64/iperf3` present (only if the darwin URL was filled in; otherwise the README placeholder remains).

- [ ] **Step 4: Drive the app once via the run-desktop skill**

Use the `run-desktop` skill (`.claude/skills/run-desktop/driver.mjs`): launch, click 作为服务器, screenshot, confirm 本机地址 shows an IP; back, click 作为客户端, screenshot. Look at the screenshots.

- [ ] **Step 5: Manual two-machine pass**

Follow `docs/two-machine-verification.md` on the actual Windows + Mac pair. This is the real acceptance test for the slice.

---

## Self-Review Checklist

- **Spec coverage:** discovery wiring (Task 7), TCP control server (Task 3) + client (Task 4), control protocol (Task 1), iperf3 daemon (Task 5), manual cross-machine iperf (Task 4 + 9), packaged-binary path fix (Task 6), IPC push state (Task 7), preload/UI wiring (Tasks 8–9), fetch script + build (Task 10), manual checklist (Task 11). All spec sections mapped.
- **Out-of-scope honored:** no automatic suite orchestration, no aggregated live report, no camera analysis, no code signing.
- **Type consistency:** `ServerSessionState` gains `listening`/`localAddresses`; `ClientSessionState` gains `lastResult`; both `getState()` implementations updated (Tasks 3, 4). `connectToAddress`, `runManualTest`, `disconnect`, `onServerState`/`onClientState`, `connectToServer`, `getLocalAddresses` names match across main/preload/global.d.ts/App.tsx.
- **Known external dependency:** the `darwin-arm64` iperf3 URL is a placeholder and must be replaced with a real static build before Mac packaging includes the binary; called out in Task 10.
```
