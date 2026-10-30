# Windows 构建与测试（x64）

## GitHub Actions

推送到 `master` 或在 Actions 手动运行 **Windows build**。流水线在 Windows runner 上安装锁定依赖、运行测试、准备 iperf3 3.21 及配套 DLL、检查运行能力，然后生成 NSIS 安装程序。

在成功运行的 Artifacts 中下载 `PC-Network-Quality-Tool-Windows-x64`，解压后安装其中的 `.exe`。产物保留 30 天。以仓库当前版本和成功运行的提交为准，不使用旧 Release 附件。

## 本地构建

安装 Node.js 22 和 Git，克隆本仓库后在 PowerShell 执行：

```powershell
npm ci
npm run fetch:iperf3
npm test
npm run dist -- --win --x64 --publish never
```

`fetch:iperf3` 使用固定的 3.21 发布 ZIP，解压可执行文件与所有 DLL，并验证版本和 `--json-stream`。不要单独复制裸 `.exe`。

安装程序位于 `release/`。没有配置签名证书时，生成的是未签名安装包。

如果本机曾配置失效的 Electron 镜像，可只在当前 PowerShell 会话改用官方源后重试：

```powershell
$env:ELECTRON_MIRROR = 'https://github.com/electron/electron/releases/download/'
npm ci
```

## 开发与验证

运行 `npm run dev`，另开终端执行 `npx electron .`。界面测试使用 `npm run e2e`，首次运行前可执行 `npx playwright install chromium` 准备浏览器。

跨机连接、权限和端口说明见 [双机验证](two-machine-verification.md)。
