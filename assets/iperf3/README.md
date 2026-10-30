# iperf3 binaries

These are downloaded by `npm run fetch:iperf3` into platform folders:

- `win32-x64/iperf3.exe`
- `darwin-arm64/iperf3`
- `darwin-x64/iperf3` (optional, for Intel Macs)

The application resolves the binary by platform and architecture at runtime
(`resolveIperfBinary` in `src/main/iperfRunner.ts`). In a packaged app they are
bundled as extraResources under `<resources>/iperf3/`.

Run `npm run fetch:iperf3` once on each build machine before `npm run dist`.

## Reproducible preparation and packaging checks

`npm run fetch:iperf3` prepares version 3.21 for the current build host:

- macOS: downloads the ESnet release source and builds static libiperf without OpenSSL, then ad-hoc signs the executable. Requires Xcode command line tools (`make`, compiler, `codesign`).
- Windows x64: downloads the ar51an 3.21 release ZIP and installs the executable together with all bundled DLLs. Requires the Windows `tar` command.

The script verifies the executable version and `--json-stream` support. On macOS it also rejects dependencies outside system libraries. `npm run package` and `npm run dist` run the same preflight and stop if binaries are missing, incompatible, or nonportable. Run the fetch step on the target build platform; cross-platform binaries cannot be runtime-verified on another operating system.

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

## Version requirement

The app uses `iperf3 --json-stream` for per-second live progress, which requires
**iperf3 ≥ 3.17**. Older builds (e.g. 3.1.x) do not support `--json-stream` and
will fail every phase. Use a 3.17+ binary on every platform.
