# Suite Orchestration + Real Report — Design Spec

**Date:** 2026-06-10
**Status:** Approved for planning
**Builds on:**
- `docs/superpowers/specs/2026-06-09-cross-machine-testing-design.md`
- `docs/superpowers/specs/2026-06-09-pc-network-quality-tool-design.md`

## Goal

Let the server operator pick a test suite and run it across all connected
clients automatically: the server dispatches the plan, each client runs the
suite's iperf phases in order and streams results back, and the server
aggregates them into a real report rendered inline on the server screen
(replacing the current sample-only preview).

This closes the orchestration gap deferred from the cross-machine slice. Manual
single-test (测试到服务器) remains available on the client.

## Decisions (locked)

- **Trigger:** server-side. The server selects a suite; it dispatches to every
  connected client. (Server is the coordinator, per the project design.)
- **Multi-client execution:** sequential. One client runs all its phases to
  completion before the next client starts — avoids `iperf3 -s` port contention
  on the single server daemon.
- **Report:** rendered inline on the server screen from real results via the
  existing `reportGenerator`, replacing the sample preview.

## Scope: which phases run

`iperfRunner.buildIperfArgs` maps only `tcp-upload`, `tcp-download`, and
`udp-quality`. The orchestrated run executes exactly these three phases (using
each suite's durations and UDP target bitrate from `buildTestPlan`).

- `connectivity`: not run as a separate measurement — the live control
  connection already proves reachability; the report notes the client as
  connected.
- `latency`: **out of scope this slice** (no ping/ICMP implementation). Documented
  as a follow-up. The client skips it.

The report's detail table shows the three iperf phases per client.

## Architecture

### Data flow

```
ServerScreen: click a suite button
  -> IPC "server:start-test" (suiteId)
  -> ControlServer.startPlan(plan):
       plan = buildTestPlan(suiteId, "separate")
       clients = connected clients snapshot
       SEQUENTIALLY, for each client:
         send {type:"start-test", plan, serverAddress} to that client's socket
         mark client status "testing"; set testingClientId
         client runs runnable phases in order:
           for each phase -> runIperf({host: serverAddress, phaseKind, durationSeconds, targetBitrateMbps})
           send {type:"phase-result", clientId, metrics} per phase
           after all phases -> send {type:"test-complete", clientId}
         server collects phase-results into a per-client ClientTestResult
         on test-complete -> advance to next client
       when all clients done:
         results = ClientTestResult[]
         summary = buildReportSummary(results)
         latestReport = assembled TestReport
         clear activePlan/testingClientId; emit state with latestReport
  -> ServerScreen renders latestReport HTML inline (via renderReportHtml at the IPC layer or stored html)
```

### Module changes

| File | Change |
|---|---|
| `src/main/controlServer.ts` | Add `startPlan(plan, clientIds)`: a sequential dispatch queue; handle inbound `phase-result` / `test-complete` in `handleConnection`; accumulate per-client results; on completion assemble `latestReport` and emit state. Add `testingClientId` to state. |
| `src/main/controlClient.ts` | In the socket data handler, handle inbound `start-test`: run runnable phases sequentially via an injectable iperf executor (default `runIperf`), send `phase-result` per phase and `test-complete` at the end; set status `testing` with a progress `statusText`. |
| `src/main/ipc.ts` | Add `server:start-test` handler calling `server.startPlan(...)`. Server state push already carries `latestReport`. |
| `src/main/preload.mts` + `src/renderer/global.d.ts` | Expose `startTest(suiteId)`. |
| `src/renderer/App.tsx` | Wire server suite buttons to `startTest`; show in-progress indicator (testingClientId); render `latestReport` HTML inline when present (replacing the sample preview path). Client screen shows testing progress text. |
| `src/main/reportGenerator.ts` | Reused unchanged. |

### Report rendering location

`reportGenerator.renderReportHtml` runs in the main process. Decision: the server
stores the assembled `TestReport` object in `ServerSessionState.latestReport`
(structured data, cheap to push). The IPC layer exposes a
`reports:latest-html` handler that renders the stored report to HTML on demand
via `renderReportHtml`. The server screen, when it observes `latestReport` is
present in pushed state, calls `reports:latest-html` once and renders the
returned HTML inline. This keeps state-tick payloads small (no large HTML string
pushed on every state change) and reuses the existing renderer untouched.

### Injectable iperf executor (for tests)

`ControlClient` gains an optional constructor/seam to inject the iperf executor
(default: the real `runIperf`). Unit tests pass a fake that returns canned
`PhaseMetrics`, so the orchestration logic is tested without spawning iperf3.

## State / types

- `ServerSessionState`: already has `activePlan?` and `latestReport?`. Add
  `testingClientId?: string` (which client is currently under test) for UI
  progress. `latestReport` holds the assembled `TestReport`.
- `ClientSessionState`: reuse `status: "testing"` + `statusText` for progress
  (e.g. "正在测试 TCP 上行 (2/3)").
- Report assembly: `results: ClientTestResult[]` (clientName from the registry,
  phases from received `phase-result`s) → `buildReportSummary(results)` → full
  `TestReport { id, createdAt, suiteId, serverName, serverAddress, clients,
  results, summary }`.

## Error handling

- A phase's iperf run fails → that phase's `metrics.errors` carries the message;
  the client continues remaining phases. The report rates that client per the
  existing errored-client branch in `buildReportSummary` (不合格).
- A client disconnects mid-test → server marks it disconnected, drops it from
  the queue, and continues with the remaining clients; the report reflects only
  completed clients.
- Operator clicks a suite with no connected clients → surfaced as a no-op with a
  UI hint ("暂无客户端连接，无法开始测试").
- Malformed control frames continue to be dropped by the decoder.

## Testing

- Unit (`controlServer`): `startPlan` over loopback with two real client sockets
  (or fakes) — assert sequential dispatch order (client B's `start-test` is sent
  only after client A's `test-complete`), result accumulation, and that a
  `TestReport` is assembled after the last client.
- Unit (`controlClient`): inject a fake iperf executor; feed a `start-test`
  frame; assert it runs the three runnable phases in order, sends a
  `phase-result` per phase and a final `test-complete`, and skips
  `connectivity`/`latency`.
- Keep all existing unit + e2e tests green.
- Manual: extend `docs/two-machine-verification.md` with the suite-run flow
  (server picks suite → both directions → report appears).

## Out of Scope (future)

- `latency` phase measurement (ping/ICMP) and `connectivity` as a distinct timed
  probe.
- Concurrent multi-client testing (per-client iperf ports).
- Report export to file (save dialog).
- Camera/video stream analysis.
- Installer code signing.
