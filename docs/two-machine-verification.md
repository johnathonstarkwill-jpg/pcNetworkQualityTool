# Two-Machine Verification (Windows + Mac)

Prerequisites:
- Both machines on the same LAN / subnet.
- iperf3 binaries fetched (`npm run fetch:iperf3`) and app built (`npm run build`).
- Firewall: allow the app when the OS prompts (Windows Defender / macOS local network).

## Steps

1. **Mac (server):** launch the app, choose 作为服务器.
   - Expect: 本机地址 lists the Mac's LAN IPv4 (e.g. 192.168.x.y).
   - Expect: an `iperf3 -s` process is running.
2. **Windows (client):** launch the app, choose 作为客户端.
   - Expect: the Mac server appears in 服务器搜索 within a few seconds (auto-discovery),
     OR type the Mac IP into 手动输入服务器 IP and click 连接.
3. **Windows:** confirm status becomes 已连接，等待服务器开始测试.
4. **Mac:** confirm the Windows client appears under 已连接客户端 with status 已连接.
5. **Windows:** click 测试到服务器.
   - Expect: status 测试中…, then a result table with TCP throughput (Mbps),
     UDP loss (%), and jitter (ms).
6. **Reverse roles** (Windows server, Mac client) and repeat steps 1–5.

## Suite run (server-orchestrated)

7. **Server:** with at least one client connected, click a suite (e.g. 快速检测).
   - Expect: connected clients show "· 测试中" in turn (sequential, one at a time).
   - Expect: each client's status text cycles through 正在测试 TCP 上行/下行/UDP …
8. **Server:** when all clients finish, a report renders inline under 测试套件
   with the rating, per-client table, and the three iperf phases
   (tcp-upload, tcp-download, udp-quality) per client.

Note: connectivity and latency phases are not measured in this version; the
report covers the three iperf throughput/loss/jitter phases.

## Live progress + suite coloring

9. **During a suite run:** both the server 运行日志 and the client 运行日志 scroll
   with per-second lines like `TCP 上行 3s: 137.0 Mbps` (server lines are
   prefixed with the client name).
10. **While running:** the suite button (server) and the client 当前套件 bar show
    blue/pulsing; on completion they turn green (优秀/合格), amber (风险), or red
    (不合格) per the report rating.

## Export report

11. **Server, after a run:** click 导出 Markdown under the report. A save dialog
    opens; choose a path. The `.md` file contains the rating, conclusion, test
    info, client table, the per-phase metrics table, and a 运行日志 section with
    this run's log lines.

## Selecting clients (multiple connected)

12. **Server, with 2 clients connected:** each appears in 已连接客户端 with a
    checkbox (default checked). Uncheck one, then click a suite — only the checked
    client(s) run. With nothing checked, the suite buttons are disabled.

## Pass criteria

- Discovery OR manual-IP connect works in at least one direction.
- Both UIs reflect the connection.
- A manual iperf run produces non-empty throughput and a loss/jitter value.

## Troubleshooting

- No discovery: UDP broadcast may be blocked — use manual IP.
- Connect fails: check the firewall prompt was allowed and both machines are on
  the same subnet.
- iperf result empty / error: confirm `iperf3 -s` is running on the server and
  the bundled binary exists for the client's platform.
