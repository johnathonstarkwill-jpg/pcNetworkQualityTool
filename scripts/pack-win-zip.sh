#!/usr/bin/env bash
#
# Build a clean source zip for compiling/testing on Windows.
# Contains the committed files at HEAD (no node_modules / dist / release / .git),
# PLUS the win32-x64 iperf3 binaries from assets/iperf3/win32-x64/ if present
# (those are .gitignored, so they are added to the zip explicitly here) — so the
# unzipped tree is ready for `npm run dist` with iperf3 already bundled.
#
#   ./scripts/pack-win-zip.sh                  # writes ../pc-network-quality-tool-win.zip
#   ./scripts/pack-win-zip.sh /path/to/out.zip # custom output path
#
# On the Windows machine: unzip, then follow docs/WINDOWS-BUILD.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-$(cd "$ROOT/.." && pwd)/pc-network-quality-tool-win.zip}"
PREFIX="pc-network-quality-tool"

# git archive snapshots the committed HEAD, not the working tree — warn if dirty.
if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: working tree has uncommitted changes — the zip uses committed HEAD, not your edits." >&2
fi

git archive --format=zip --prefix="$PREFIX/" -o "$OUT" HEAD

# Add the Windows iperf3 binaries (gitignored, so not in the archive) under the
# same prefix, so the unzipped tree already has assets/iperf3/win32-x64/.
WIN_IPERF="assets/iperf3/win32-x64"
if [ -d "$WIN_IPERF" ] && [ -n "$(ls -A "$WIN_IPERF" 2>/dev/null)" ]; then
  STAGE="$(mktemp -d)"
  mkdir -p "$STAGE/$PREFIX/$WIN_IPERF"
  cp "$WIN_IPERF"/* "$STAGE/$PREFIX/$WIN_IPERF/"
  ( cd "$STAGE" && zip -rq "$OUT" "$PREFIX/$WIN_IPERF" )
  rm -rf "$STAGE"
  echo "Bundled $WIN_IPERF ($(ls "$WIN_IPERF" | tr '\n' ' '))"
else
  echo "Note: $WIN_IPERF is empty — Windows iperf3 not bundled; place it there before packing." >&2
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Wrote $OUT ($SIZE) from commit $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
