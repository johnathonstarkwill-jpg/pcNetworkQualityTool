# iperf3 binaries

These are downloaded by `npm run fetch:iperf3` into platform folders:

- `win32-x64/iperf3.exe`
- `darwin-arm64/iperf3`
- `darwin-x64/iperf3` (optional, for Intel Macs)

The application resolves the binary by platform and architecture at runtime
(`resolveIperfBinary` in `src/main/iperfRunner.ts`). In a packaged app they are
bundled as extraResources under `<resources>/iperf3/`.

Run `npm run fetch:iperf3` once on each build machine before `npm run dist`.

## Choosing real binary URLs (build-machine setup)

The URLs in `scripts/fetch-iperf3.mjs` are placeholders and MUST be replaced
before packaging ships working binaries:

- **darwin-arm64 / darwin-x64**: point at a real static macOS `iperf3` build
  (e.g. a trusted GitHub release asset). A Homebrew-installed `iperf3` is
  dynamically linked and not portable, so prefer a static build.
- **win32-x64**: most Windows `iperf3` distributions (incl. iperf.fr) ship as a
  ZIP containing `iperf3.exe` **plus** `cygwin1.dll` (and sometimes other
  `cygwin-*.dll`). A bare `iperf3.exe` will fail to launch without those DLLs.
  Either:
  1. download the ZIP, extract it, and place `iperf3.exe` together with its
     `cygwin*.dll` files in `win32-x64/` (update the fetch script to extract via
     `child_process` + `Expand-Archive`/`unzip`), or
  2. use a natively-compiled standalone Windows build that needs no Cygwin DLLs.

## macOS code signing (Apple Silicon)

On arm64 macOS, an unsigned or invalidly-signed binary is killed on launch with
`Killed: 9` (SIGKILL → exit 137), so the iperf phases fail with
`iperf3 exited with code null`. A locally-built or freshly-downloaded `iperf3`
must carry a valid signature. For development, ad-hoc sign it:

```bash
codesign --force -s - assets/iperf3/darwin-arm64/iperf3
```

When the app is packaged, electron-builder signs the `.app` (and its bundled
resources) during the macOS build, so a properly-signed binary is shipped.
Verify a binary is runnable with `codesign -v <path>` and a quick
`<path> -c 127.0.0.1 -t 1` against a local `iperf3 -s`.
