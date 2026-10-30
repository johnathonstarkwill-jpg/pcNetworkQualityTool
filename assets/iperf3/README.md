# iperf3 runtime

Run `npm run fetch:iperf3` on the target build host before packaging. The script prepares pinned **iperf3 3.21** under `assets/iperf3/<platform>-<arch>/`. Generated binaries are ignored by Git and bundled into the app as extra resources.

- **macOS**: download the ESnet 3.21 release source, build static libiperf without OpenSSL, then ad-hoc sign the executable. Requires Xcode command line tools, `make`, compiler and `codesign`.
- **Windows x64**: download the ar51an 3.21 release ZIP, extract the executable and all bundled DLLs using Windows `tar`. Keep the DLLs beside `iperf3.exe`.

`node scripts/check-iperf3.mjs` verifies version >= 3.21 and `--json-stream`. On macOS it also rejects dependencies outside system libraries. Both packaging commands run this preflight; missing or incompatible binaries stop packaging.

The runtime directory is selected by platform and architecture, so validate Windows binaries on Windows rather than on a Mac build host. Current packaging targets are Windows x64 and macOS Apple Silicon.

## macOS signing

The fetch step signs the iperf3 executable for local use. That is separate from signing the finished Electron app. When packaging without an Apple signing identity, apply an ad-hoc signature to the completed `.app` before creating its DMG, then verify with `codesign --verify --deep --strict`. A local ad-hoc signature is not Apple notarization.

## Sources

- [ESnet iperf3 releases](https://github.com/esnet/iperf/releases)
- [Windows binary releases](https://github.com/ar51an/iperf3-win-builds/releases)
