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
