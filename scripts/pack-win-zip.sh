#!/usr/bin/env bash
#
# Build a clean source zip for compiling/testing on Windows.
# Contains exactly the committed files at HEAD (no node_modules / dist / release
# / .git / fetched iperf3 binaries — those are .gitignored and rebuilt on Windows).
#
#   ./scripts/pack-win-zip.sh                  # writes ../pc-network-quality-tool-win.zip
#   ./scripts/pack-win-zip.sh /path/to/out.zip # custom output path
#
# On the Windows machine: unzip, then follow docs/WINDOWS-BUILD.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-$(cd "$ROOT/.." && pwd)/pc-network-quality-tool-win.zip}"

# git archive snapshots the committed HEAD, not the working tree — warn if dirty.
if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: working tree has uncommitted changes — the zip uses committed HEAD, not your edits." >&2
fi

git archive --format=zip --prefix=pc-network-quality-tool/ -o "$OUT" HEAD

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Wrote $OUT ($SIZE) from commit $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
