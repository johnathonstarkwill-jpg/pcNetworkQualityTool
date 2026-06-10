# Live Progress Log + Suite Status Coloring — Design Spec

**Date:** 2026-06-10
**Status:** Approved for planning
**Builds on:**
- `docs/superpowers/specs/2026-06-10-suite-orchestration-design.md`
- `docs/superpowers/specs/2026-06-09-cross-machine-testing-design.md`

## Goal

Make test progress legible on both screens so an operator/customer is never left
staring at a frozen UI:

1. A live, console-like log panel on **both** the server and client screens that
   streams per-second iperf data and progress events in real time.
2. Test-suite **status coloring** by report rating — on the server's suite
   buttons and on a client-side current-suite status bar — so a finished suite
   visibly turns green/yellow/red.

## Decisions (locked)

- **Log granularity:** per-second streaming. iperf3 runs with `--json-stream`
  (NDJSON: one JSON object per interval, then an `end` object). Requires
  iperf3 ≥ 3.17 (local build is 3.17.1).
- **Server log content:** orchestration events **plus** relayed per-second data
  from clients (clients send `log` control messages; the server prefixes each
  with the client name).
- **Client suite indicator:** a single "current suite" status bar (the client
  only ever runs the one suite the server dispatches), not a full mirrored list.
- **Suite color semantics:** by report rating — 优秀/合格 = green, 风险 =
  yellow, 不合格 = red; running = blue (animated).

## Architecture

### Data source: iperf3 `--json-stream`

`src/main/iperfRunner.ts`:
- `buildIperfArgs` replaces `-J` with `--json-stream`.
- `runIperf(input, onInterval?)` gains an optional callback invoked once per
  interval with `{ phaseKind, second, throughputMbps, udpLossPercent?, jitterMs? }`.
- A streaming NDJSON parser splits stdout on `\n`, `JSON.parse`es each line,
  dispatches `event === "interval"` to `onInterval` and keeps the
  `event === "end"` payload to produce the final `PhaseMetrics` (reusing the
  existing field extraction, now reading from the `end` event's `data`).
- Malformed lines are skipped without throwing.

### Log model

- `src/main/logBuffer.ts` (new): `export const MAX_LOG_LINES = 500;` and
  `appendLog(buffer: string[], line: string): string[]` — returns a new array,
  dropping the oldest line(s) past the cap (immutable). Each line is prefixed
  with an `HH:MM:SS` timestamp by the caller via a small `stamp(line)` helper in
  the same module.
- `ControlMessage` gains `{ type: "log"; clientId: string; line: string }` and
  `{ type: "suite-complete"; suiteId: TestSuiteId; rating: ReportSummary["rating"] }`.
- `ServerSessionState` gains `log: string[]` and
  `suiteRatings: Partial<Record<TestSuiteId, ReportSummary["rating"]>>`.
- `ClientSessionState` gains `log: string[]` and
  `currentSuite?: { label: string; status: "running" | ReportSummary["rating"] }`.

### Client (`ControlClient`)

- Holds `log: string[]`. `pushLog(line)`: `appendLog` + emit state; if a socket
  is connected, also send `{ type: "log", clientId, line }` to the server.
- `runManualTest` and `runPlan` pass an `onInterval` to `runIperf` that formats a
  line (e.g. `TCP 上行 3s: 137.0 Mbps`, `UDP 5s: 丢包 0.0% 抖动 0.01ms`) and
  calls `pushLog`. Phase start/end and failures also `pushLog`.
- On inbound `start-test`: set `currentSuite = { label: plan.label, status: "running" }`.
- On inbound `suite-complete`: set `currentSuite = { label, status: rating }`.

### Server (`ControlServer`)

- Holds `log: string[]` and `suiteRatings`. `pushLog(line)`: `appendLog` + emit.
- On inbound `log` message: `pushLog(`${clientName} ${line}`)` (clientName from
  registry, falls back to clientId).
- Orchestration milestones `pushLog`: client connect/disconnect, "派发测试给 X",
  "X 完成", "报告就绪：评级 <rating>".
- `finalizeRun`: set `suiteRatings[plan.suiteId] = report.summary.rating`, then
  `broadcast({ type: "suite-complete", suiteId: plan.suiteId, rating })` to all
  clients.

### Renderer (`App.tsx` + `styles.css`)

- Shared `<LogConsole lines={...} />`-style block: a monospace, dark, fixed-height,
  `overflow:auto` `<pre>` that renders `log.join("\n")` and auto-scrolls to the
  bottom on update (a `ref` + `useEffect` setting `scrollTop = scrollHeight`).
  Server screen: below the suite list. Client screen: below the test block.
- Suite coloring:
  - A `ratingClass(rating)` helper maps 优秀/合格 → `suite-pass`, 风险 →
    `suite-risk`, 不合格 → `suite-fail`.
  - Server suite buttons: class is `suite-running` when
    `state.activePlan?.suiteId === suite.id`, else `ratingClass(state.suiteRatings[suite.id])`
    when present, else default.
  - Client current-suite status bar: `suite-running` when status === "running",
    else `ratingClass(status)`.
- CSS: `.suite-running` (blue, subtle pulse), `.suite-pass` (green),
  `.suite-risk` (yellow/amber), `.suite-fail` (red), `.log-console`
  (monospace, dark bg `#0f1720`, light text, height ~220px, `overflow:auto`).

## Error handling

- iperf phase failure → a log line `X 阶段失败：<msg>` plus the existing
  `metrics.errors` path (report still rates 不合格).
- Malformed NDJSON interval line → skipped, no crash.
- Log buffer capped at `MAX_LOG_LINES` to bound memory.
- A `log`/`suite-complete` message for an unknown client/suite is appended/ignored
  safely (no throw).

## Testing

- Unit (`iperfRunner`): feed NDJSON (`start`, several `interval`, `end`) to the
  parser → assert `onInterval` called once per interval with correct values and
  the returned `PhaseMetrics` matches the `end` payload (tcp throughput; udp
  loss/jitter). Update the existing `iperfParser` tests for the new
  `--json-stream` arg and `end`-event parsing.
- Unit (`logBuffer`): `appendLog` returns a new array, preserves order, drops
  oldest past `MAX_LOG_LINES`, never mutates input.
- Integration (`controlChannel`): a fake `iperfExec` that invokes `onInterval`
  → assert the client accumulates log lines and sends `log` messages, and the
  server appends them with the client-name prefix; after a run assert
  `suiteRatings[suiteId]` is set and a `suite-complete` reached the client
  (`currentSuite.status` becomes the rating).
- Keep all existing unit + e2e tests green (the e2e electron smoke still asserts
  suite labels render).

## Out of scope (future)

- Persisting/exporting logs to a file.
- Coloring suites by anything other than the latest rating (e.g. history).
- Per-stream (multi-connection) interval detail in the log.
- Replacing iperf3 < 3.17 fallback (text-mode parsing) — the tool requires ≥ 3.17.
