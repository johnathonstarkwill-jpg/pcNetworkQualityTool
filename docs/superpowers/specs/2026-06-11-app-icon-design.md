# App Icon — Design Spec

**Date:** 2026-06-11
**Status:** Approved for planning

## Goal

Replace the default Electron icon with a custom brand icon (variant V2: a
Wi‑Fi‑style signal fan with a green "verified" check badge, on a blue
rounded-square background) across the packaged macOS and Windows builds.

## Decisions (locked)

- **Concept:** V2 — three white Wi‑Fi signal arcs + a small white source dot,
  with a green (#1ea54a) circular check badge at the lower-right, on a blue
  vertical gradient rounded-square (#1a7fd4 → #0d4f88). Reads as "network signal,
  quality verified".
- **Source of truth:** an SVG at `build/icon.svg` (1024×1024 canvas, with safe
  margins so the badge isn't clipped by macOS icon masking).
- **Rasterization:** a repeatable script renders the SVG to `build/icon.png`
  (1024×1024). `electron-builder` generates the per-platform `.icns`/`.ico` from
  that PNG at package time.

## Architecture

### Files

| File | Responsibility |
|---|---|
| `build/icon.svg` | Vector source of the V2 icon (committed). |
| `build/icon.png` | 1024×1024 raster used by electron-builder + the dev window (committed). |
| `scripts/render-icon.mjs` | Renders `build/icon.svg` → `build/icon.png` via Playwright/Chromium (deterministic, headless). |
| `package.json` | `"icon": "node scripts/render-icon.mjs"` script. |
| `electron-builder.yml` | `mac.icon: build/icon.png` and `win.icon: build/icon.png`. |
| `src/main/main.ts` | `BrowserWindow` gets `icon: <resolved build/icon.png>` (dev/Linux taskbar; harmless on mac/win packaged). |

### Rasterization

`scripts/render-icon.mjs` launches headless Chromium (`playwright-core`, already
a dependency), loads `build/icon.svg` sized to 1024×1024 on a transparent page,
and screenshots to `build/icon.png` with `omitBackground: true` so the rounded
corners stay transparent. Run via `npm run icon`.

### electron-builder

`electron-builder.yml` gains:

```yaml
mac:
  icon: build/icon.png
win:
  icon: build/icon.png
```

electron-builder accepts a ≥512×512 PNG and produces the macOS `.icns` and
Windows `.ico` during `npm run dist` / `npm run package`. No manual icon
conversion or committed `.icns`/`.ico` needed.

### Dev window icon

`src/main/main.ts` resolves `build/icon.png` relative to the app root and passes
it as the `BrowserWindow` `icon` option. On macOS the dock icon comes from the
app bundle (so this is a no-op there when packaged), and on Windows the taskbar
icon comes from the exe; the option mainly helps the dev run and Linux. Resolve
defensively: only set `icon` if the file exists, so a missing asset never crashes
window creation.

## Icon geometry (V2, on a 1024 canvas)

- Rounded-square background, `rx ≈ 230`, gradient `#1a7fd4 → #0d4f88`.
- Two white signal arcs centered horizontally, upper-middle, `stroke-width
  ≈ 58`, round caps, slightly translucent (`opacity ≈ 0.95`).
- White source dot below the arcs.
- Green check badge: circle `fill #1ea54a`, white `stroke` ring, white check
  path, positioned lower-right but kept within ~`8%` safe margin from the canvas
  edges so macOS corner masking and Windows scaling don't clip it.

## Error handling

- `render-icon.mjs` fails loudly (non-zero exit) if the SVG is missing or
  Chromium can't launch, so a broken icon can't silently ship a blank PNG.
- `main.ts` guards the `icon` option behind an existence check.

## Testing / verification

- `npm run icon` produces a 1024×1024 `build/icon.png`; eyeball it.
- `npm run build` stays clean.
- `npm run package` (`--dir`) builds the app; visually confirm
  `release/mac-arm64/PC Network Quality Tool.app` shows the custom icon (not the
  default Electron atom).
- No unit tests (pure asset/config).

## Out of scope

- Animated/adaptive icons, dark-mode icon variant, in-app logo/branding.
- Committing pre-generated `.icns`/`.ico` (electron-builder generates them).
