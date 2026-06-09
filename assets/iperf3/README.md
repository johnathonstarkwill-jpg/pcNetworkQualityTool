# iperf3 binaries

These are downloaded by `npm run fetch:iperf3` into platform folders:

- `win32-x64/iperf3.exe`
- `darwin-arm64/iperf3`
- `darwin-x64/iperf3` (optional, for Intel Macs)

The application resolves the binary by platform and architecture at runtime
(`resolveIperfBinary` in `src/main/iperfRunner.ts`). In a packaged app they are
bundled as extraResources under `<resources>/iperf3/`.

Run `npm run fetch:iperf3` once on each build machine before `npm run dist`.
