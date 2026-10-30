# PC Network Quality Tool

离线运行的 Windows / macOS 双机网络测试工具。展示端到端实测数据，不作质量评级。

- TCP 上下行吞吐量、发送速率与重传次数。
- 双向 UDP 目标速率、接收速率、丢包和抖动。
- 空载及 TCP 负载 RTT、延迟增量。
- 每秒吞吐趋势、波动、零吞吐区间及采样缺口。
- 多客户端保持连接，所有测速统一排队，Markdown 导出完整数据。

## 使用

两端安装同一版本。一台选择服务器，其他电脑选择客户端，发现或手动输入服务器的局域网 IP。服务端勾选客户端后启动套件；客户端也可点击“测试到服务器”提交排队请求。

- [双机及多客户端验证](docs/two-machine-verification.md)
- [指标定义与测量口径](docs/network-metrics.md)
- [Windows 构建与流水线](docs/WINDOWS-BUILD.md)
- [iperf3 准备与依赖检查](assets/iperf3/README.md)

## 开发与构建

使用 Node.js 22。运行 `npm ci` 安装锁定依赖，`npm run fetch:iperf3` 准备当前平台的测速程序。

```sh
npm test
npm run build
npm run e2e
```

开发时运行 `npm run dev`，另开终端运行 `npx electron .`。macOS 也可使用 `bash scripts/dev-mac.sh`。

`npm run dist -- --publish never` 在当前平台生成安装包。Windows 的 GitHub Actions 会在推送到 `master` 或手动触发后编译并上传 x64 安装程序，构建产物保留 30 天。

macOS 本地临时签名包未做 Apple 公证；正式分发需自行配置签名与公证。
