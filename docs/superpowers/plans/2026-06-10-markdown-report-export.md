# Markdown Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server operator export the latest test report (including this run's log) as a Markdown file via a native save dialog.

**Architecture:** A pure `renderReportMarkdown(report, log)` in reportGenerator builds the Markdown; an `reports:export-markdown` IPC handler renders it from `server.getLatestReport()` + `server.getState().log`, shows `dialog.showSaveDialog`, and writes the file; a server-screen button triggers it.

**Tech Stack:** Electron (`dialog`), Node `fs/promises`, TypeScript, React, Vitest.

---

## Source Spec

`docs/superpowers/specs/2026-06-10-markdown-report-export-design.md`

## File Structure

```text
src/main/reportGenerator.ts   [modify] add renderReportMarkdown(report, log)
src/main/ipc.ts               [modify] reports:export-markdown handler (dialog + writeFile)
src/main/preload.mts          [modify] expose exportReportMarkdown
src/renderer/global.d.ts      [modify] type exportReportMarkdown
src/renderer/App.tsx          [modify] 导出 Markdown button + transient note
tests/unit/reportGenerator.test.ts [modify] renderReportMarkdown tests
docs/two-machine-verification.md   [modify] export step
```

---

## Task 1: renderReportMarkdown

**Files:**
- Modify: `src/main/reportGenerator.ts`
- Test: `tests/unit/reportGenerator.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/reportGenerator.test.ts` (the file already imports from `../../src/main/reportGenerator` and `TestReport` types — add `renderReportMarkdown` to the import; if the test file builds a `TestReport` fixture already, reuse its shape). Add:

```ts
import { renderReportMarkdown } from "../../src/main/reportGenerator";
import type { TestReport } from "../../src/shared/types";

describe("renderReportMarkdown", () => {
  const baseReport: TestReport = {
    id: "r1",
    createdAt: "2026-06-10T01:02:03.000Z",
    suiteId: "quick-check",
    serverName: "测试服务器",
    serverAddress: "192.168.0.8",
    clients: [{ id: "c1", name: "客户端 A", address: "192.168.0.9", status: "connected" }],
    results: [
      {
        clientId: "c1",
        clientName: "客户端 A",
        phases: [
          { phaseId: "tcp-upload", throughputMbps: 120.5, errors: [] },
          { phaseId: "udp-quality", throughputMbps: 8, udpLossPercent: 0, jitterMs: 0.5, errors: [] }
        ]
      }
    ],
    summary: { rating: "优秀", conclusion: "网络质量优秀。", recommendation: "可用于视频会议。" }
  };

  it("renders title, rating, conclusion, client name, phase rows, and table separators", () => {
    const md = renderReportMarkdown(baseReport, ["[10:00:00] 开始", "[10:00:01] 完成"]);
    expect(md).toContain("# 网络质量测试报告");
    expect(md).toContain("优秀");
    expect(md).toContain("网络质量优秀。");
    expect(md).toContain("客户端 A");
    expect(md).toContain("tcp-upload");
    expect(md).toContain("| --- |");
  });

  it("includes the run log inside a fenced block", () => {
    const md = renderReportMarkdown(baseReport, ["[10:00:00] 开始测试", "[10:00:01] TCP 上行 1s: 120.5 Mbps"]);
    expect(md).toContain("## 运行日志");
    expect(md).toContain("```");
    expect(md).toContain("[10:00:01] TCP 上行 1s: 120.5 Mbps");
  });

  it("shows (无日志) when the log is empty", () => {
    const md = renderReportMarkdown(baseReport, []);
    expect(md).toContain("(无日志)");
  });

  it("escapes pipe characters in cell values so table rows stay intact", () => {
    const report: TestReport = {
      ...baseReport,
      results: [
        {
          clientId: "c1",
          clientName: "A|B",
          phases: [{ phaseId: "tcp-upload", throughputMbps: 1, errors: [] }]
        }
      ]
    };
    const md = renderReportMarkdown(report, []);
    expect(md).toContain("A\\|B");
    expect(md).not.toContain("| A|B |");
  });

  it("formats missing numeric metrics as -", () => {
    const md = renderReportMarkdown(baseReport, []);
    // tcp-upload has no udpLossPercent/jitterMs -> "-"
    expect(md).toContain("| 客户端 A | tcp-upload | 120.50 | - | - |  |");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/reportGenerator.test.ts`
Expected: FAIL — `renderReportMarkdown` not exported.

- [ ] **Step 3: Implement**

In `src/main/reportGenerator.ts`, add this exported function (after `renderReportHtml`) and a `mdCell` helper (near `escapeHtml`). It reuses the existing private `formatNumber`.

```ts
export function renderReportMarkdown(report: TestReport, log: string[]): string {
  const clientRows = report.clients
    .map((client) => `| ${mdCell(client.name)} | ${mdCell(client.address)} | ${mdCell(client.status)} |`)
    .join("\n");

  const resultRows = report.results
    .flatMap((result) =>
      result.phases.map(
        (phase) =>
          `| ${mdCell(result.clientName)} | ${mdCell(phase.phaseId)} | ${formatNumber(phase.throughputMbps)} | ${formatNumber(phase.udpLossPercent)} | ${formatNumber(phase.jitterMs)} | ${mdCell(phase.errors.join("; "))} |`
      )
    )
    .join("\n");

  const logBlock = log.length > 0 ? log.join("\n") : "(无日志)";

  return `# 网络质量测试报告

**评级：** ${report.summary.rating}

${report.summary.conclusion}

${report.summary.recommendation}

## 测试信息

- 时间：${report.createdAt}
- 服务器：${report.serverName} - ${report.serverAddress}
- 套件：${report.suiteId}

## 客户端

| 名称 | IP | 状态 |
| --- | --- | --- |
${clientRows}

## 详细指标

| 客户端 | 阶段 | 吞吐量 Mbps | UDP 丢包 % | 抖动 ms | 错误 |
| --- | --- | --- | --- | --- | --- |
${resultRows}

## 运行日志

\`\`\`
${logBlock}
\`\`\`
`;
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- tests/unit/reportGenerator.test.ts`
Expected: PASS (existing reportGenerator tests + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/main/reportGenerator.ts tests/unit/reportGenerator.test.ts
git commit -m "feat: render test report as markdown with run log"
```

---

## Task 2: IPC export handler

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Add the handler**

In `src/main/ipc.ts`:

(a) Update imports:
- Add `dialog` to the electron import: `import { type WebContents, dialog, ipcMain } from "electron";`
- Add `import { writeFile } from "node:fs/promises";`
- Add `renderReportMarkdown` to the reportGenerator import (alongside `renderReportHtml`, `buildReportSummary`).

(b) Add a filename-timestamp helper at module scope (near the bottom, beside the other module functions):

```ts
function timestampForFile(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
```

(c) Add the handler inside `registerIpcHandlers`, next to the other `reports:` handlers:

```ts
  ipcMain.handle("reports:export-markdown", async () => {
    const report = server.getLatestReport();
    if (!report) return { saved: false };

    const markdown = renderReportMarkdown(report, server.getState().log);
    const defaultName = `网络质量测试报告-${report.suiteId}-${timestampForFile(report.createdAt)}.md`;

    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };

    await writeFile(result.filePath, markdown, "utf8");
    return { saved: true, path: result.filePath };
  });
```

- [ ] **Step 2: Typecheck + tests**

Run: `npm run build`
Expected: clean. (`server.getLatestReport()` and `server.getState().log` exist; `dialog.showSaveDialog` is typed by electron.)

Run: `npm test`
Expected: all pass (no new unit tests here; ipc isn't unit-tested but must compile).

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: export latest report as markdown via save dialog"
```

---

## Task 3: Preload + renderer types

**Files:**
- Modify: `src/main/preload.mts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Expose in preload**

In `src/main/preload.mts`, add to the `exposeInMainWorld("networkTool", { ... })` object (next to the other `reports`/report methods):

```ts
  exportReportMarkdown: () =>
    ipcRenderer.invoke("reports:export-markdown") as Promise<{ saved: boolean; path?: string }>,
```

- [ ] **Step 2: Type in global.d.ts**

In `src/renderer/global.d.ts`, add to the `networkTool` interface:

```ts
      exportReportMarkdown(): Promise<{ saved: boolean; path?: string }>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.mts src/renderer/global.d.ts
git commit -m "feat: expose markdown export to renderer"
```

---

## Task 4: Server-screen export button + verification

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `docs/two-machine-verification.md`

- [ ] **Step 1: Add the button + note to ServerScreen**

In `src/renderer/App.tsx` `ServerScreen`:

(a) Add an export-note state next to the existing `reportHtml` state:

```tsx
  const [exportNote, setExportNote] = useState<string>("");
```

(b) Add the handler (next to `startTest`):

```tsx
  async function exportMarkdown() {
    try {
      const result = await window.networkTool.exportReportMarkdown();
      if (result.saved) setExportNote(`已导出：${result.path ?? ""}`);
    } catch {
      setExportNote("导出失败，请重试");
    }
  }
```

(c) Replace the existing inline report block:

```tsx
          {reportHtml ? (
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : null}
```

with (adds an export button + note, shown only when a real report exists):

```tsx
          {state?.latestReport ? (
            <div className="report-actions">
              <button type="button" className="secondary" onClick={() => void exportMarkdown()}>
                导出 Markdown
              </button>
              {exportNote ? <span className="export-note">{exportNote}</span> : null}
            </div>
          ) : null}
          {reportHtml ? (
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : null}
```

- [ ] **Step 2: Add minimal styles**

Append to `src/renderer/styles.css`:

```css
.report-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0 4px;
}

.export-note {
  color: #52636f;
  font-size: 14px;
  word-break: break-all;
}
```

- [ ] **Step 3: Build + e2e**

Run: `npm run build`
Expected: clean.

Run: `npm run e2e`
Expected: 2 pass (the electron smoke clicks 作为服务器 and checks suite labels; unaffected — the export button only appears after a real run).

- [ ] **Step 4: Document the export step**

In `docs/two-machine-verification.md`, after the "## Live progress + suite coloring" section, add:

```md
## Export report

11. **Server, after a run:** click 导出 Markdown under the report. A save dialog
    opens; choose a path. The `.md` file contains the rating, conclusion, test
    info, client table, the per-phase metrics table, and a 运行日志 section with
    this run's log lines.
```

- [ ] **Step 5: Full verification**

Run: `npm test`
Expected: all unit tests pass (reportGenerator incl. the 5 new markdown tests, plus everything else).

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles.css docs/two-machine-verification.md
git commit -m "feat: server screen markdown export button"
```

---

## Self-Review Checklist

- **Spec coverage:** `renderReportMarkdown(report, log)` with run-log section (Task 1); server-only IPC export with save dialog + file write + default filename from `report.createdAt` (Task 2); preload/types (Task 3); server-screen button shown only when `latestReport` exists + transient note + docs (Task 4). Markdown content mirrors the HTML report; pipe/newline cell sanitization via `mdCell`; empty log → `(无日志)`; missing metrics → `-` via existing `formatNumber`.
- **Out of scope honored:** no HTML/PDF export, no client export, no auto-save/fixed dir.
- **Type consistency:** `renderReportMarkdown(report: TestReport, log: string[])` used in Task 2; `exportReportMarkdown(): Promise<{ saved: boolean; path?: string }>` identical across preload (Task 3), global.d.ts (Task 3), and App.tsx call (Task 4). `server.getLatestReport()`/`server.getState().log` already exist from the orchestration + live-progress slices.
- **Placeholder scan:** none.
```
