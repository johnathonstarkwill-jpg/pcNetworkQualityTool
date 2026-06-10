# Per-Client Test Selection — Design Spec

**Date:** 2026-06-10
**Status:** Approved for planning
**Builds on:**
- `docs/superpowers/specs/2026-06-10-suite-orchestration-design.md`

## Goal

When multiple clients are connected, let the server operator choose which
connected clients a test suite runs against, instead of always running all of
them. Selection is via checkboxes in the connected-clients list (default: all
connected clients selected).

## Background

The orchestration core already supports running against a subset:
`ControlServer.startPlan(plan, clientIds)` takes an explicit client-id list. The
only gap is that the `server:start-test` IPC handler hardcodes "all connected
clients" and the UI offers no selection. This slice adds the selection plumbing.

## Decisions (locked)

- **Selection model:** checkboxes in the connected-clients list (option A). The
  suite buttons run against the checked clients. Default: all connected clients
  checked.
- **Only connected clients are selectable.** A client whose status is `testing`
  or `disconnected` has no enabled checkbox.
- **No client selected → suite buttons disabled.**
- **Backward compatible IPC:** `clientIds` is optional; when omitted the handler
  runs all connected clients (preserves the existing contract).

## Architecture

### Data flow

```
ServerScreen keeps selectedIds: Set<string>, reconciled against state.clients
  on each state push:
    - a newly connected client id not seen before -> add (default checked)
    - an id no longer connected -> remove
Connected-clients list renders a checkbox per client (checked = in selectedIds).
Click a suite button ->
  startTest(suiteId, [...selectedIds])
  -> IPC "server:start-test" (suiteId, clientIds?)
       ids = clientIds
             ? connectedIds ∩ clientIds
             : connectedIds            // omitted => all (backward compatible)
       if ids.length === 0 -> return false
       server.startPlan(buildTestPlan(suiteId, "separate"), ids)
       return true
```

### Module changes

| File | Change |
|---|---|
| `src/main/ipc.ts` | `server:start-test` accepts optional `clientIds: string[]`. Computes `connectedIds` as today; if `clientIds` is provided, intersect with it. If the result is empty, return `false`. Otherwise `startPlan` with the resulting ids. |
| `src/main/preload.mts` | `startTest(suiteId, clientIds?)` → `ipcRenderer.invoke("server:start-test", suiteId, clientIds)`. |
| `src/renderer/global.d.ts` | `startTest(suiteId: TestSuiteId, clientIds?: string[]): Promise<boolean>`. |
| `src/renderer/App.tsx` | ServerScreen: a `selectedIds` state (`Set<string>`) reconciled from `state.clients` in an effect; a checkbox per client row (enabled only when `status === "connected"`); suite buttons `disabled` when `testing` or no connected client is selected; suite `onClick` passes `[...selectedIds]`. The no-clients alert message becomes "请选择至少一个已连接客户端，再开始测试". |

### Selection reconciliation (renderer)

`ServerScreen` derives the set of currently-connected client ids from
`state.clients`. An effect keyed on that id list updates `selectedIds`:
- ids that are connected but not yet tracked → added (default selected);
- ids in `selectedIds` that are no longer connected → removed.

This keeps the default "all connected selected" while letting the operator
uncheck specific clients. Checking/unchecking a box toggles membership in
`selectedIds` (immutable `new Set(prev)` update).

### Backward-compatible handler

```ts
ipcMain.handle("server:start-test", (_event, suiteId: TestSuiteId, clientIds?: string[]) => {
  const connectedIds = server.getState().clients.filter((c) => c.status === "connected").map((c) => c.id);
  const ids = clientIds ? connectedIds.filter((id) => clientIds.includes(id)) : connectedIds;
  if (ids.length === 0) return false;
  server.startPlan(buildTestPlan(suiteId, "separate"), ids);
  return true;
});
```

## Error handling

- `clientIds` containing stale/disconnected ids → filtered out by the
  intersection with `connectedIds`.
- Empty result (nothing selected, or all selected ids disconnected) → handler
  returns `false`; the UI shows "请选择至少一个已连接客户端，再开始测试".
- A client disconnecting mid-run is already handled by the orchestration
  (`handleClientGone` advances the queue) — unchanged.

## Testing

- Unit (`controlChannel`): two clients connect; `server.startPlan(plan, [oneId])`
  → the resulting `latestReport.results` contains only that one client; the
  other client never receives `start-test`. (The core already supports subsets;
  this test pins the selection behavior.)
- The IPC handler's intersection logic is simple and not unit-tested directly
  (ipc.ts is not unit-tested); covered by reasoning + the renderer wiring.
- Keep all existing unit + e2e tests green (the electron smoke still selects the
  server role and sees suite buttons render).

## Out of scope

- Client-side suite selection (previously declined).
- Per-client different suites, or client grouping/presets.
- Remembering selection across sessions.
