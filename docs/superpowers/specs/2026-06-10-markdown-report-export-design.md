# Markdown Report Export — Design Spec

**Date:** 2026-06-10
**Status:** Approved for planning
**Builds on:**
- `docs/superpowers/specs/2026-06-10-suite-orchestration-design.md`
- `docs/superpowers/specs/2026-06-10-live-progress-and-suite-coloring-design.md`

## Goal

Let the server operator export the latest test report as a Markdown file,
including this run's progress log. Export is **server-only** — consistent with
the server-as-coordinator model (the client never owns a report).

## Decisions (locked)

- **Server-only.** No client export. The server holds `latestReport` and the run
  `log`; both go into the file.
- **Format:** Markdown only (no HTML/PDF export). The inline HTML preview stays.
- **Includes the run log.** The Markdown appends a "运行日志" section containing
  the server's current `log` lines in a fenced code block.
- **Save dialog.** The user picks the destination via the native save dialog.

## Architecture

### Data flow

```
ServerScreen: click 导出 Markdown (shown only when latestReport exists)
  -> IPC "reports:export-markdown"
  -> main: report = server.getLatestReport(); if none -> { saved: false }
           log = server.getState().log
           md = renderReportMarkdown(report, log)
           dialog.showSaveDialog({ defaultPath, filters:[{name:"Markdown",extensions:["md"]}] })
           if canceled -> { saved: false }
           else fs.writeFile(path, md, "utf8") -> { saved: true, path }
  -> renderer shows a short "已导出：<path>" note, or nothing on cancel
```

### Module changes

| File | Change |
|---|---|
| `src/main/reportGenerator.ts` | Add pure `renderReportMarkdown(report: TestReport, log: string[]): string` — mirrors the HTML report content as Markdown, plus a 运行日志 section. |
| `src/main/ipc.ts` | Add `reports:export-markdown` handler: builds the markdown from `server.getLatestReport()` + `server.getState().log`, shows `dialog.showSaveDialog`, writes the file. Returns `{ saved: boolean; path?: string }`. |
| `src/main/preload.mts` + `src/renderer/global.d.ts` | Expose `exportReportMarkdown(): Promise<{ saved: boolean; path?: string }>`. |
| `src/renderer/App.tsx` | Server screen: an 导出 Markdown button next to the inline report (rendered only when `state.latestReport` is present); show a transient "已导出：<path>" line after a successful export. |

### Markdown content (renderReportMarkdown)

Sections, mirroring `renderReportHtml`:

```markdown
# 网络质量测试报告

**评级：** <rating>

<conclusion>

<recommendation>

## 测试信息

- 时间：<createdAt>
- 服务器：<serverName> - <serverAddress>
- 套件：<suiteId>

## 客户端

| 名称 | IP | 状态 |
| --- | --- | --- |
| <name> | <address> | <status> |

## 详细指标

| 客户端 | 阶段 | 吞吐量 Mbps | UDP 丢包 % | 抖动 ms | 错误 |
| --- | --- | --- | --- | --- | --- |
| <clientName> | <phaseId> | <throughputMbps|-> | <udpLossPercent|-> | <jitterMs|-> | <errors joined|> |

## 运行日志

​```
<log line 1>
<log line 2>
...
​```
```

- Numbers formatted with the existing `formatNumber` helper (2 decimals, `-` when
  undefined). Cell values that could contain `|` or newlines (client name,
  errors) are sanitized: replace `|` with `\|` and strip newlines, so table rows
  stay intact.
- If `log` is empty, the 运行日志 fenced block contains `(无日志)`.

### Error handling

- No `latestReport` → handler returns `{ saved: false }` (and the button is not
  shown anyway).
- User cancels the save dialog (`canceled === true` or no `filePath`) →
  `{ saved: false }`, UI stays silent.
- `fs.writeFile` failure → the handler lets the error propagate (Electron rejects
  the renderer promise); the renderer catches it and shows "导出失败，请重试".

### Default filename

`网络质量测试报告-<suiteId>-<YYYYMMDD-HHmmss>.md`, where the timestamp is derived
from `report.createdAt` (deterministic — the report's own creation time). Spaces
avoided for shell friendliness.

## Testing

- Unit (`reportGenerator`): `renderReportMarkdown(report, log)` →
  - contains `# 网络质量测试报告`, the rating, conclusion, the client name, a
    detail-table row with the phase id, and Markdown table separators (`| --- |`).
  - includes the 运行日志 fenced block with the provided log lines.
  - empty log → `(无日志)` in the block.
  - a client name containing `|` is escaped (no broken table row).
- The IPC dialog + file write are not unit-tested (Electron API); covered by
  manual verification.
- Keep all existing unit + e2e tests green.

## Out of scope

- HTML / PDF export.
- Client-side export (the client owns no report).
- Auto-saving without a dialog, or a fixed output directory.
