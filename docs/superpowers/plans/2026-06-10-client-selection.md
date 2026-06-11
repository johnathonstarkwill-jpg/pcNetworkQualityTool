# Per-Client Test Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server operator choose which connected clients a suite runs against, via checkboxes (default all connected selected), instead of always running every connected client.

**Architecture:** The orchestration core (`ControlServer.startPlan(plan, clientIds)`) already runs a subset; this slice plumbs a selection through the IPC handler and adds checkboxes to the server screen.

**Tech Stack:** Electron, TypeScript, React, Vitest.

---

## Source Spec

`docs/superpowers/specs/2026-06-10-client-selection-design.md`

## File Structure

```text
tests/unit/controlChannel.test.ts  [modify] subset-selection regression test
src/main/ipc.ts                    [modify] server:start-test accepts optional clientIds
src/main/preload.mts               [modify] startTest(suiteId, clientIds?)
src/renderer/global.d.ts           [modify] startTest signature
src/renderer/App.tsx               [modify] ServerScreen checkboxes + selectedIds
src/renderer/styles.css            [modify] client-row checkbox layout
docs/two-machine-verification.md   [modify] selection step
```

---

## Task 1: Regression test — startPlan runs only the selected subset

**Files:**
- Modify: `tests/unit/controlChannel.test.ts`

This pins the behavior the UI relies on. `startPlan` already supports a subset, so
the test passes immediately — it guards against regressions.

- [ ] **Step 1: Append the test**

Append to `tests/unit/controlChannel.test.ts`:

```ts
describe("ControlServer.startPlan client subset", () => {
  it("runs only the selected client and excludes the other", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const exec = async (input: { phaseKind: string }) => {
      await new Promise((r) => setTimeout(r, 5));
      return { phaseId: input.phaseKind, throughputMbps: 10, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const mk = (id: string) =>
      new Promise<InstanceType<typeof ControlClient>>((resolve) => {
        const c = new ControlClient({ iperfExec: exec as never, id, name: id });
        c.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(c); });
        c.connectToAddress("127.0.0.1", port);
      });

    const a = await mk("A");
    const b = await mk("B");

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => { if (s.latestReport) resolve(s); });
    });
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["A"]); // only A

    const finalState = await reported;
    expect(finalState.latestReport?.results.length).toBe(1);
    expect(finalState.latestReport?.results[0].clientId).toBe("A");
    // B was never asked to test.
    expect(b.getState().currentSuite).toBeUndefined();

    a.disconnect();
    b.disconnect();
    await srv.close();
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npm test -- tests/unit/controlChannel.test.ts`
Expected: PASS (the core already supports subsets; this is a characterization/regression guard).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/controlChannel.test.ts
git commit -m "test: pin startPlan client-subset selection"
```

---

## Task 2: IPC handler + bridge accept optional clientIds

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.mts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Update the IPC handler**

In `src/main/ipc.ts`, replace the existing `server:start-test` handler:

```ts
  ipcMain.handle("server:start-test", (_event, suiteId: TestSuiteId) => {
    const connectedIds = server
      .getState()
      .clients.filter((c) => c.status === "connected")
      .map((c) => c.id);
    if (connectedIds.length === 0) return false;
    server.startPlan(buildTestPlan(suiteId, "separate"), connectedIds);
    return true;
  });
```

with (adds an optional `clientIds` filter, backward compatible):

```ts
  ipcMain.handle("server:start-test", (_event, suiteId: TestSuiteId, clientIds?: string[]) => {
    const connectedIds = server
      .getState()
      .clients.filter((c) => c.status === "connected")
      .map((c) => c.id);
    const ids = clientIds ? connectedIds.filter((id) => clientIds.includes(id)) : connectedIds;
    if (ids.length === 0) return false;
    server.startPlan(buildTestPlan(suiteId, "separate"), ids);
    return true;
  });
```

- [ ] **Step 2: Update preload**

In `src/main/preload.mts`, replace the `startTest` entry:

```ts
  startTest: (suiteId: TestSuiteId) => ipcRenderer.invoke("server:start-test", suiteId) as Promise<boolean>,
```

with:

```ts
  startTest: (suiteId: TestSuiteId, clientIds?: string[]) =>
    ipcRenderer.invoke("server:start-test", suiteId, clientIds) as Promise<boolean>,
```

- [ ] **Step 3: Update global.d.ts**

In `src/renderer/global.d.ts`, replace:

```ts
      startTest(suiteId: TestSuiteId): Promise<boolean>;
```

with:

```ts
      startTest(suiteId: TestSuiteId, clientIds?: string[]): Promise<boolean>;
```

- [ ] **Step 4: Build + tests**

Run: `npm run build`
Expected: clean. (The renderer's current `startTest(suite.id)` call still type-checks — `clientIds` is optional.)

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/preload.mts src/renderer/global.d.ts
git commit -m "feat: server:start-test accepts optional client ids"
```

---

## Task 3: Server screen — client checkboxes + selection

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add selection state, reconciliation, and a toggle**

In `src/renderer/App.tsx` `ServerScreen`:

(a) Add `useRef` to the React import if not present (it is already imported for `LogConsole`).

(b) Add state + a "seen ids" ref + reconciliation effect, after the existing `exportNote` state and before `const testing = ...`:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());

  const connectedIds = state?.clients.filter((c) => c.status === "connected").map((c) => c.id) ?? [];
  const connectedKey = connectedIds.join(",");

  useEffect(() => {
    const newlyConnected = connectedIds.filter((id) => !seenRef.current.has(id));
    connectedIds.forEach((id) => seenRef.current.add(id));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of connectedIds) {
        // default-select clients we have not seen before; otherwise keep the operator's choice
        if (newlyConnected.includes(id) || prev.has(id)) next.add(id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey]);

  function toggleClient(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
```

(c) Replace the `testing`/`hasClients` lines:

```tsx
  const testing = Boolean(state?.activePlan);
  const hasClients = (state?.clients.filter((c) => c.status !== "disconnected").length ?? 0) > 0;
```

with (drop `hasClients`, the selection drives the buttons now):

```tsx
  const testing = Boolean(state?.activePlan);
```

(d) Change the `startTest` signature + message:

```tsx
  async function startTest(suiteId: TestSuiteId) {
    try {
      const started = await window.networkTool.startTest(suiteId);
      if (!started) alert("暂无客户端连接，无法开始测试");
    } catch {
      alert("启动测试时发生错误，请重试");
    }
  }
```

to:

```tsx
  async function startTest(suiteId: TestSuiteId) {
    try {
      const started = await window.networkTool.startTest(suiteId, [...selectedIds]);
      if (!started) alert("请选择至少一个已连接客户端，再开始测试");
    } catch {
      alert("启动测试时发生错误，请重试");
    }
  }
```

- [ ] **Step 2: Render checkboxes in the connected-clients list**

Replace the connected-clients `<ul>` block:

```tsx
          {state && state.clients.length > 0 ? (
            <ul className="client-list">
              {state.clients.map((c) => (
                <li key={c.id}>
                  {c.name}（{c.address}）— {CLIENT_STATUS_LABELS[c.status]}
                  {state.testingClientId === c.id ? " · 测试中" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无客户端连接</p>
          )}
```

with:

```tsx
          {state && state.clients.length > 0 ? (
            <ul className="client-list">
              {state.clients.map((c) => (
                <li key={c.id}>
                  <label className="client-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      disabled={c.status !== "connected" || testing}
                      onChange={() => toggleClient(c.id)}
                    />
                    <span>
                      {c.name}（{c.address}）— {CLIENT_STATUS_LABELS[c.status]}
                      {state.testingClientId === c.id ? " · 测试中" : ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无客户端连接</p>
          )}
```

- [ ] **Step 3: Update the suite-button disabled condition**

In the suite-list `.map`, change the button's `disabled`:

```tsx
                  disabled={testing || !hasClients}
```

to:

```tsx
                  disabled={testing || selectedIds.size === 0}
```

- [ ] **Step 4: Add styles**

Append to `src/renderer/styles.css`:

```css
.client-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.client-row input {
  width: 16px;
  height: 16px;
}
```

- [ ] **Step 5: Build + e2e + unit**

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: 2 pass. (The electron smoke clicks 作为服务器 and asserts suite labels render; the suite buttons still render — now disabled until a client is selected, but visible.)

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: select which connected clients a suite tests"
```

---

## Task 4: Docs + full verification

**Files:**
- Modify: `docs/two-machine-verification.md`

- [ ] **Step 1: Document selection**

In `docs/two-machine-verification.md`, after the "## Export report" section (or at the end), add:

```md
## Selecting clients (multiple connected)

12. **Server, with 2 clients connected:** each appears in 已连接客户端 with a
    checkbox (default checked). Uncheck one, then click a suite — only the checked
    client(s) run. With nothing checked, the suite buttons are disabled.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: all unit tests pass (controlChannel incl. the new subset test, plus everything else).

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: 2 pass.

- [ ] **Step 3: Commit**

```bash
git add docs/two-machine-verification.md
git commit -m "docs: document per-client test selection"
```

---

## Self-Review Checklist

- **Spec coverage:** subset-selection core pinned by a regression test (Task 1); IPC `server:start-test(suiteId, clientIds?)` with `connectedIds ∩ clientIds`, empty → false (Task 2); preload + global.d.ts `startTest(suiteId, clientIds?)` (Task 2); ServerScreen `selectedIds` reconciled from `state.clients` (default-select newly connected, keep operator's choice, drop disconnected), checkbox per client (enabled only when connected and not testing), suite buttons disabled when testing or nothing selected, onClick passes `[...selectedIds]`, alert message updated (Task 3); docs (Task 4).
- **Backward compatibility:** `clientIds` optional everywhere; the renderer always passes it now, but omitting it still runs all connected clients (existing contract preserved).
- **Type consistency:** `startTest(suiteId: TestSuiteId, clientIds?: string[]): Promise<boolean>` identical across ipc handler args, preload, global.d.ts, and the App call. `selectedIds: Set<string>`, `toggleClient(id: string)`, `connectedIds`/`connectedKey` consistent within ServerScreen.
- **Placeholder scan:** none.
```
