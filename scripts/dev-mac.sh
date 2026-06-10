#!/usr/bin/env bash
#
# Launch the PC Network Quality Tool on macOS in dev mode (Vite + Electron).
#
#   ./scripts/dev-mac.sh              # launch one instance
#   ./scripts/dev-mac.sh server       # launch an instance with its own data dir
#   ./scripts/dev-mac.sh client       # ...run in a second terminal for a 1-machine self-test
#
# Closing the app window (or Ctrl-C) stops the instance; the Vite dev server is
# stopped too if THIS invocation started it (a second instance leaves it running).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTANCE="${1:-default}"
UDD="/tmp/pcnq-udd-${INSTANCE}"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON" ]; then
  echo "Electron not found — run 'npm install' first." >&2
  exit 1
fi

# Build main process + renderer (Electron loads compiled dist/main).
echo "Building..."
npm run build

# Ad-hoc sign the bundled macOS iperf3 so it isn't SIGKILLed on Apple Silicon.
# (No-op if the binary is absent — you only need it for real iperf tests.)
BIN="$ROOT/assets/iperf3/darwin-arm64/iperf3"
if [ -f "$BIN" ]; then
  codesign --force -s - "$BIN" >/dev/null 2>&1 && echo "Signed iperf3 binary." || true
fi

# Start the Vite dev server only if it isn't already running.
VITE_PID=""
if ! curl -s -o /dev/null http://127.0.0.1:5173; then
  echo "Starting Vite dev server..."
  npm run dev >/tmp/pcnq-vite.log 2>&1 &
  VITE_PID=$!
fi

echo "Waiting for Vite on http://127.0.0.1:5173 ..."
until curl -s -o /dev/null http://127.0.0.1:5173; do sleep 0.5; done
echo "Vite ready."

cleanup() {
  echo
  echo "Stopping..."
  if [ -n "$VITE_PID" ]; then kill "$VITE_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

echo "Launching app (instance: ${INSTANCE}). Close the window to quit."
"$ELECTRON" . --user-data-dir="$UDD"
