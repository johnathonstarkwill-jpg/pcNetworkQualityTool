# Cross-Machine Testing Slice — Design Spec

**Date:** 2026-06-09
**Status:** Approved for planning
**Builds on:** `docs/superpowers/specs/2026-06-09-pc-network-quality-tool-design.md`,
`docs/superpowers/plans/2026-06-09-pc-network-quality-tool.md`

## Goal

Make a Windows PC and a Mac discover each other, establish a TCP control
connection, and sync session state in both UIs — plus run `iperf3` manually
across the two machines to verify real network quality. Produce a macOS `dmg`
(built on Mac) and a Windows `nsis` installer (built on the Windows machine).

This is the next slice after the first-version scaffold. Automatic test-suite
orchestration and the aggregated report are explicitly **out of scope** here;
this slice ends at: two machines connected, state synced, and a single manual
`iperf3` run showing throughput / loss / jitter on the client.

## Success Criteria

1. Server PC enters server role → broadcasts presence (UDP), listens for control
   connections (TCP), and starts an `iperf3 -s` daemon.
2. Client PC enters client role → discovers the server in a live list, or
   connects via manually-entered IP.
3. On connect, the client registers; both UIs show the connection (server lists
   the client, client shows "connected").
4. Client can manually run one short `iperf3` test against the server and see
   throughput, UDP loss, and jitter in its UI.
5. `npm run dist` produces a `dmg` on Mac and an `nsis` installer on Windows,
   each bundling the correct platform `iperf3` binary.

## Decisions (locked)

- **Control transport:** raw TCP + newline-delimited JSON (option A). No
  third-party library. Reuses the existing `ControlMessage` union in
  `src/shared/types.ts`.
- **iperf role mapping:** server PC is the coordinator and runs `iperf3 -s`;
  client PC runs `iperf3 -c <serverIP>` on manual trigger.
- **Windows build:** built on the Windows machine (no wine, no cross-compile).
  Mac builds the `dmg` natively.
- **iperf3 binaries:** a build script downloads official per-platform binaries
  into `assets/iperf3/<platform>-<arch>/`.

## Architecture

### New / changed modules

```
src/main/
  discovery.ts        [change] start broadcaster/scanner from main; expire stale servers by lastSeen
  controlServer.ts    [change] embed net.Server on TCP 48200; map socket -> client; emit state
  controlClient.ts    [change] net.Socket connect/register/receive; emit state
  controlProtocol.ts  [new]    newline-JSON encode + streaming decoder (handles partial/multiple frames, drops bad lines)
  iperfServer.ts      [new]    start/stop an `iperf3 -s` daemon for the server role
  iperfRunner.ts      [reuse]  runIperf for the client-side manual test
  netInfo.ts          [new]    list local IPv4 addresses (move/reuse getLikelyLocalAddresses)
scripts/
  fetch-iperf3.mjs    [new]    download per-platform iperf3 into assets/iperf3/<platform>-<arch>/
```

### Fixed ports

- Discovery UDP: `48101` (existing `DISCOVERY_PORT`).
- Control TCP: `48200`.
- iperf3: `5201` (iperf3 default).

### Control protocol

`controlProtocol.ts`:
- `encode(msg: ControlMessage): string` → `JSON.stringify(msg) + "\n"`.
- `createDecoder()` → stateful: accumulates a string buffer, splits on `\n`,
  `JSON.parse` each complete line, yields valid `ControlMessage`s, discards
  malformed lines (logged, never throws).

Message flow:

```
server role  -> ControlServer.listen(48200) + DiscoveryBroadcaster.start()
client role  -> DiscoveryScanner.start() -> discovered list pushed to UI
client picks server / types IP -> ControlClient.connect(ip, 48200)
             -> send {type:"register-client", client}
server recv  -> register socket -> send {type:"client-registered", clientId}
             -> both sides emit "state" -> pushed to renderer
disconnect   -> socket close -> markClientDisconnected -> UI updates
```

### iperf manual cross-machine test

- Entering the server role: `iperfServer.start()` spawns `iperf3 -s` bound to all
  interfaces; leaving the role calls `iperfServer.stop()`.
- Client UI, once connected, shows a "测试到服务器" button → IPC →
  `runIperf({ host: serverIP, phaseKind, durationSeconds: 5 })` runs one short
  TCP-upload test and one UDP test; results (throughput / loss / jitter) render
  on the client screen.
- "Manual" means user-triggered. No automatic suite orchestration or report
  generation in this slice.

### IPC + preload + UI wiring

New IPC handlers: `discovery:start`, `discovery:stop`, `server:start`,
`server:stop`, `client:connect` (ip), `client:run-iperf`,
`net:local-addresses`.

State delivery changes from pull-only (`invoke`) to **push**: the main process
sends state changes via `webContents.send`, and preload exposes
`onServerState(cb)` / `onClientState(cb)` subscriptions (in addition to the
existing getters). The renderer subscribes on mount and unsubscribes on unmount.

UI:
- **ServerScreen:** on enter, start server + discovery + `iperf3 -s`; display
  local IPv4 address(es) for the client to type; show a live list of connected
  clients.
- **ClientScreen:** live discovered-server list (click to connect); wire the
  manual IP input (submit to connect); show connection status; "测试到服务器"
  button + result display.

All new user-facing strings are Chinese, consistent with the existing UI. (No
second locale is in use in this project; the established UI is Chinese-only.)

### Build & iperf3 acquisition

- `scripts/fetch-iperf3.mjs`: downloads win32-x64 + darwin-arm64 (darwin-x64
  optional) official iperf3 binaries, verifies them, and places them under
  `assets/iperf3/<platform>-<arch>/`. Idempotent; safe to re-run.
- `package.json`: add `"fetch:iperf3": "node scripts/fetch-iperf3.mjs"`.
- Mac: `npm run fetch:iperf3 && npm run dist` → `dmg`.
- Windows machine: clone + `npm i` + `npm run fetch:iperf3` + `npm run dist` →
  `nsis`.
- `electron-builder.yml` already maps `extraResources: assets/iperf3 -> iperf3`.
- **Bug fix (pre-existing):** `resolveIperfBinary()` currently resolves a path
  relative to `assets/iperf3`, which is wrong in a packaged app. It must resolve
  to `process.resourcesPath/iperf3/<platform>-<arch>/<bin>` when packaged
  (`app.isPackaged`) and fall back to the repo `assets/iperf3` path in dev.

## Error Handling

- TCP connect failure / timeout → client status `error` + Chinese guidance
  (check firewall / same subnet).
- Missing iperf3 binary or spawn failure → explicit error surfaced to the UI;
  never silently swallowed.
- Malformed control message → discarded + logged; process does not crash.
- Control/iperf port already in use → startup error surfaced with guidance.

## Testing

- Unit: `controlProtocol` (encode/decode, partial frames, coalesced frames, bad
  lines), `iperfServer` argument construction.
- Keep existing unit tests (discovery, iperfParser, reportGenerator, testPlans).
- Integration (no real second machine): start a `ControlServer` and a
  `ControlClient` over loopback sockets; assert register → `client-registered`
  → state flow on both sides; assert disconnect updates state.
- Manual two-machine verification: a documented checklist of operator steps
  (roles, IPs, firewall prompts, expected UI states, iperf result).

## Out of Scope (next slices)

- Automatic test-suite orchestration (server dispatches a `TestPlan`, clients run
  all phases, server aggregates).
- Aggregated `TestReport` generation from real cross-machine results (the report
  generator and renderer already exist; only the live data pipeline is deferred).
- Camera/video stream analysis.
- Code signing / notarization of installers.
