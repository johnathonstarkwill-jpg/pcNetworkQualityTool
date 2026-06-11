# Windows 构建与测试（64 位）

本包是**源码快照**（不含 node_modules / dist / release）。在一台 64 位 Windows 机上
按下面步骤编译出 nsis 安装包并测试。

## 1. 前置

- **Node.js LTS（18 或更高）**：https://nodejs.org 下载安装（自带 npm）。
- **Git**（可选）。
- 不需要 Visual Studio —— 本项目无原生模块需要编译。

## 2. 安装依赖

解压后，在项目目录打开 PowerShell 或 cmd：

```powershell
npm install
```

如果 electron 二进制下载卡住（镜像问题），用官方源重试：

```powershell
set ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/
npm install
```

## 3. Windows 版 iperf3

应用按 `iperf3 --json-stream` 取每秒数据，**要求 iperf3 ≥ 3.17**。

**本包通常已自带**：如果 `assets\iperf3\win32-x64\` 里已有 `iperf3.exe` 加
`cygwin1.dll` / `cygcrypto-3.dll` / `cygz.dll`（用 `scripts/pack-win-zip.sh`
打的包会带上 iperf3 3.21），**这步可跳过**，直接到第 4 步。

如果该目录是空的，手动放：
1. 下载 64 位 Windows 版 iperf3 3.17+（zip，内含 `iperf3.exe` + `cygwin*.dll`）。
2. 把 `iperf3.exe` **和所有 `cyg*.dll`** 一起放进 `assets\iperf3\win32-x64\`。

> `scripts\fetch-iperf3.mjs` 里的 URL 是占位符，别依赖它。

## 4. 出安装包

```powershell
npm run dist
```

= `tsc + vite build` 然后 `electron-builder`（读 `electron-builder.yml`，win target =
nsis，默认 x64）。产物在 `release\` 目录：

```
release\PC Network Quality Tool Setup <版本>.exe
```

双击即可安装。

## 5. 测试

```powershell
npm test        # 单元测试（43 个）
npm run build   # 类型检查 + 构建
```

本机跑界面（开发模式，会开真窗口）：

```powershell
npm run dev
```
另开一个终端：
```powershell
node_modules\electron\dist\electron.exe .
```

双机测试：本机做服务器/另一台做客户端（或反之），按 `docs\two-machine-verification.md`。
首次连接时 Windows Defender 防火墙会弹允许网络访问 —— 选允许。

## 注意

- 安装包**未代码签名** → SmartScreen 会提示"未知发布者"，点"仍要运行"即可。
- macOS 版二进制不在本包内（不需要）；Windows 只需 win32-x64 的 iperf3。
