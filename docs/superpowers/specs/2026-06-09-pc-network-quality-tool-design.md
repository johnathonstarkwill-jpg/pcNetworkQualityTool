# PC-to-PC Network Quality Test Tool Design

Date: 2026-06-09

## Goal

Build an offline desktop tool for field staff to test network facilities between PCs. The first version focuses on 2-3 computers:

- 1 server PC.
- 1 or 2 client PCs.
- Tests can run against one client at a time or against two clients concurrently.

The tool must be simple enough for non-IT field staff. It should hide local URLs, ports, command lines, and low-level network parameters behind a desktop UI and scenario-based test buttons.

## First-Version Scope

Version 1 supports PC-to-PC network quality testing only.

It includes:

- Windows and macOS desktop apps built with Electron.
- One installer/app package per platform.
- Fully offline operation.
- Built-in test engine binaries such as `iperf3`; users do not install dependencies separately.
- Server and client roles in the same app.
- Automatic server discovery on the local network.
- Manual IP connection as a fallback.
- Detailed reports suitable for field staff and technical reviewers.

It does not include:

- Camera stream analysis.
- Hikvision/Dahua private protocol support.
- RTSP/ONVIF tooling.
- Cloud report upload.
- Online accounts.
- Online updates.
- Mobile apps.
- Public internet NAT traversal.
- System-level weak-network simulation.
- Deep packet capture analysis.
- Official support for more than 2 clients in one test run.

Camera/video stream quality analysis is planned as a second-version add-on tool.

## Product Shape

Each computer installs the same Electron desktop application.

On launch, the first screen presents two primary actions:

- "作为服务器"
- "作为客户端"

The app should not ask field staff to open `127.0.0.1`, choose ports, run commands, install `iperf3`, install Node.js, or use Homebrew.

The application may run local services internally, but those details must stay hidden from the user.

## Roles

### Server Mode

Server mode is used on the central test PC.

Responsibilities:

- Start the coordination service.
- Start the local test endpoint.
- Advertise itself on the local network for automatic discovery.
- Display available local IP addresses.
- Show connected clients.
- Let the user select test suites and target clients.
- Coordinate sequential and concurrent tests.
- Collect all results.
- Generate and display reports.
- Export reports to HTML and PDF.

### Client Mode

Client mode is used on one or two endpoint PCs.

Responsibilities:

- Automatically search for nearby test servers.
- Show discovered servers in a simple list.
- Connect to the selected server.
- Provide manual IP connection only as a fallback.
- Wait for the server to start tests.
- Execute assigned test phases.
- Return results and status updates to the server.

## Supported Topologies

The first version supports:

- 2 PCs: 1 server + 1 client.
- 3 PCs: 1 server + 2 clients.

For 3-PC testing, the server supports:

- Test client A only.
- Test client B only.
- Test client A and client B separately.
- Test client A and client B concurrently.
- Run a full suite that includes separate and concurrent phases.

The architecture should not prevent future support for more clients, but the first version should present and validate only 1-2 client workflows.

## Discovery and Connection

Automatic discovery is the default.

Server mode broadcasts its presence on the local network. Client mode scans for servers and displays human-readable entries such as:

- "测试服务器 - 192.168.1.23"
- "会议室网络测试 - 10.0.0.18"

If discovery fails, the client UI offers a secondary manual IP input. The server UI always shows local IP addresses so field staff can read the address from the server screen.

Connection state must use clear Chinese status text:

- "正在搜索服务器"
- "已发现服务器"
- "正在连接"
- "已连接，等待服务器开始测试"
- "无法连接，请检查是否在同一网络"

## Test Suites

The app presents test suites using business language, not raw network parameters.

### Quick Check

Duration: about 1-2 minutes.

Purpose:

- Quickly identify obvious connectivity, latency, throughput, or packet-loss problems.

Includes:

- Connectivity check.
- Basic latency sampling.
- Short TCP throughput test.
- Short UDP loss/jitter test.

### Standard Acceptance

Duration: about 5-8 minutes.

Purpose:

- Produce a formal acceptance report for the network path.

Includes:

- Connectivity check.
- Latency distribution.
- TCP upload and download throughput.
- UDP packet loss and jitter.
- Separate client tests.
- Concurrent client tests when two clients are connected.

### Video Meeting Simulation

Duration: about 3-5 minutes.

Purpose:

- Simulate real-time meeting traffic such as Zoom, Teams, Tencent Meeting, or similar tools.

Focus:

- UDP packet loss.
- Jitter.
- Consecutive loss.
- Bidirectional stability.
- Suitability for real-time audio/video.

### HD Video Transfer Simulation

Duration: about 3-5 minutes.

Purpose:

- Simulate sustained high-bitrate video traffic such as 1080p or 4K streams.

Focus:

- Sustained throughput.
- UDP loss under fixed target bitrate.
- Jitter.
- Bandwidth stability over time.

### Long Stability Test

Duration options:

- 30 minutes.
- 1 hour.
- 4 hours.

Purpose:

- Detect intermittent loss, wireless instability, device overheating, link congestion, and other time-based issues.

Focus:

- Periodic latency.
- Periodic throughput samples.
- UDP loss/jitter trends.
- Dropouts and reconnection events.

## Metrics

Reports should include:

- Reachability.
- TCP upload throughput.
- TCP download throughput.
- Optional bidirectional TCP throughput.
- UDP target bitrate.
- UDP actual bitrate.
- UDP packet loss percentage.
- Consecutive packet-loss events.
- Jitter.
- Latency min/avg/max/p95/p99.
- Test duration.
- Client disconnects.
- Test phase failures.
- Concurrent-test degradation compared with single-client baseline.

## Report Design

Reports serve two audiences:

- Field staff who need a clear conclusion.
- Technical staff who need detailed metrics and evidence.

The report starts with:

- Overall rating: "优秀", "合格", "风险", or "不合格".
- A short plain-language conclusion.
- Recommended next action.

The report includes:

- Test time.
- Server computer name and IP.
- Client names and IPs.
- Selected test suite.
- Test topology.
- Single-client result summary.
- Concurrent result summary.
- Video meeting suitability.
- 1080p/4K video-transfer suitability.
- Anomaly list.
- Detailed metric tables.
- Time-series charts.
- Raw test parameters.
- App version.
- OS version.

Example conclusion:

"客户端 B 在并发视频模拟时出现 3.2% UDP 丢包，不建议用于高清视频传输。建议检查客户端 B 所在交换机端口、网线或无线信号。"

Reports are generated on the server and can be exported as:

- HTML.
- PDF.

The internal report format should preserve structured data so later versions can add JSON export or report comparison.

## Technical Architecture

The application uses Electron for the desktop shell, installer packaging, local UI, and report viewing.

Electron main process responsibilities:

- Start and stop local services.
- Manage bundled binaries.
- Invoke `iperf3` or other test executables.
- Parse test results.
- Handle privileged actions when needed.
- Manage report files.
- Export PDF.

Electron renderer responsibilities:

- Role selection UI.
- Server dashboard.
- Client connection UI.
- Test suite selection.
- Progress display.
- Report display.
- User-facing error messages.

The first version should use `iperf3` as the primary measurement engine for TCP throughput, UDP packet loss, and jitter. Platform-specific `iperf3` binaries are bundled into the installer.

If `iperf3` cannot provide enough video-simulation detail, a later version can add a small custom UDP traffic generator for scenario-specific reporting. This is not required for the first version unless implementation tests show a hard gap.

## Data Flow

1. User starts server mode on one PC.
2. Server starts control service and test endpoint.
3. Server advertises itself on the local network.
4. User starts client mode on one or two PCs.
5. Clients discover and connect to the server.
6. Server shows connected clients.
7. User selects a test suite and target mode.
8. Server sends a test plan to clients.
9. Clients execute test phases and send status updates.
10. Server collects raw results.
11. Server computes summary metrics and ratings.
12. Server generates the final report.

## Permissions

Field staff may run the app with administrator privileges.

The app should request elevated permissions only when needed:

- Firewall rule creation or repair.
- Network permission checks.
- Access to platform-specific network details.

Normal startup, client connection, report viewing, and report export should not require elevation unless platform rules require it.

On macOS, the app must clearly guide the user through local network permission prompts.

On Windows, the app must clearly guide the user through firewall permission prompts and offer automatic repair when possible.

## Offline Operation

All version 1 features must work without internet access.

The installer includes:

- Electron app.
- UI assets.
- Test engine binaries.
- Report templates.
- Any required runtime files.

The app must not require:

- Cloud login.
- License server.
- Online package download.
- Online documentation.
- Online report rendering.

## Error Handling

All errors should be shown in plain Chinese with a likely cause and next action.

Examples:

| Scenario | Message |
| --- | --- |
| Server not found | "没有发现测试服务器。请确认服务器电脑已选择‘作为服务器’，并且三台电脑连接在同一个网络。" |
| Discovery failed | "自动搜索失败。可以手动输入服务器界面显示的 IP 地址。" |
| Firewall blocked | "系统防火墙可能阻止了测试。请点击‘自动修复’，或允许本软件通过防火墙。" |
| Client disconnected | "客户端 A 已断开，本次报告会标记为未完成。" |
| Severe packet loss | "当前链路丢包严重，可能影响视频会议和实时传输。" |
| Throughput drop | "测试期间带宽明显下降，建议检查无线信号、交换机端口、网线或并发占用。" |
| Insufficient permission | "需要管理员权限才能完成网络配置检查。请重新以管理员身份运行。" |
| macOS local network denied | "macOS 需要允许本软件访问本地网络，请在系统弹窗中选择允许。" |

## Second-Version Add-On: Camera Stream Quality Analysis

Camera stream analysis is explicitly outside the first version.

For version 2, add a separate tool module for Hikvision and Dahua camera data analysis using standard protocols first:

- RTSP stream analysis.
- ONVIF device discovery and metadata.
- Optional GB/T 28181 support if required by deployment scenarios.

Version 2 should avoid deep private SDK integration unless a specific customer requirement justifies the added complexity.

Possible version 2 metrics:

- Camera brand and model.
- Stream URL.
- Encoding format.
- Resolution.
- Actual frame rate.
- Actual bitrate.
- Frame-rate fluctuation.
- Keyframe interval.
- RTP loss.
- RTP jitter.
- Stream interruption count.
- Long-running stream stability.

This module should be designed as an add-on tool so it does not complicate the first-version PC-to-PC acceptance workflow.

## Acceptance Criteria

Version 1 is acceptable when:

- A non-IT field user can install the app on Windows and macOS without separate dependencies.
- One PC can start server mode.
- One or two PCs can start client mode and discover the server automatically on the same local network.
- Manual IP fallback works when discovery fails.
- The server can run quick, standard, video meeting, HD video, and long stability test suites.
- The server can run tests for one client or two clients.
- The server can run separate and concurrent two-client tests.
- Reports include a clear rating, plain-language conclusion, detailed metrics, charts, and raw parameters.
- HTML and PDF export work offline.
- Firewall, permission, discovery, disconnect, and failed-test cases produce actionable Chinese messages.

