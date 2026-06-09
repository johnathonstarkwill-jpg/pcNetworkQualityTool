---
name: run-desktop
description: Build, run, and drive the PC Network Quality Tool Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, build it, or interact with its UI.
---

PC Network Quality Tool is an Electron desktop app (TypeScript main + preload,
React renderer). For agent/automated use, drive it via the Playwright REPL at
`.claude/skills/run-desktop/driver.mjs`.

All paths are relative to the repo root.

## How it loads

Launched from `node_modules/electron` (not packaged), `electron-is-dev` is true,
so the main process loads the renderer from the **Vite dev server** at
`http://127.0.0.1:5173`. You must have both the compiled main process and the
dev server running before launching.

## Build + start dev server

```bash
npm install
npm run build          # compiles dist/main (main + preload.mjs) and dist/renderer
npm run dev &          # serves the renderer at http://127.0.0.1:5173
until curl -s -o /dev/null http://127.0.0.1:5173; do sleep 0.5; done
```

## Run (agent path)

```bash
node .claude/skills/run-desktop/driver.mjs
```

Wrap in tmux for interactive use:

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'node .claude/skills/run-desktop/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t app 'launch' Enter
timeout 60 bash -c 'until tmux capture-pane -t app -p | grep -q "networkTool bridge"; do sleep 0.2; done'
tmux send-keys -t app 'ss landing' Enter
tmux capture-pane -t app -p
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, report whether the `networkTool` bridge is live |
| `ss [name]` | full-page screenshot -> `/tmp/shots/<name>.png` |
| `click-text <text>` | click button/link containing text (e.g. `作为服务器`, `预览报告`, `返回`, `作为客户端`) |
| `type <text>` | keyboard input (e.g. into the manual-IP field) |
| `text [css-sel]` | print innerText of selector (or whole body) |
| `eval <js>` | evaluate JS in the page, print JSON |
| `quit` | close app, exit |

Typical flow: `launch` -> `click-text 作为服务器` -> `ss server` ->
`click-text 预览报告` -> `ss report` (rating + metric tables render).

## Gotchas

- **Preload must be ESM `.mjs` with `sandbox: false`.** Sandboxed preloads run
  as CommonJS; the preload uses ESM `import`, so it must be emitted as
  `dist/main/preload.mjs` (from `src/main/preload.mts`) and the window must set
  `sandbox: false`. If `launch` reports `networkTool bridge: false`, the preload
  failed to load and the entire IPC bridge is dead — rebuild and check
  `webPreferences.preload` points at `preload.mjs`.
- **Dev server required.** Without `npm run dev`, the window loads a blank page
  (it is pointed at `127.0.0.1:5173`).

## Troubleshooting

- **Launch timeout (30s):** `dist/main/main.js` missing -> run `npm run build`.
- **Blank window:** dev server not up -> `npm run dev` and wait for port 5173.
- **`networkTool bridge: false`:** preload regression -> see Gotchas.
