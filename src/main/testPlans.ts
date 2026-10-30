import type { TestPhase, TestPlan, TestSuiteId } from "../shared/types.js";

export interface TestSuiteDefinition {
  id: TestSuiteId;
  label: string;
  description: string;
}

export interface BuildPlanOptions {
  durationSeconds?: number;
}

const TEST_SUITES: TestSuiteDefinition[] = [
  {
    id: "quick-check",
    label: "快速检测",
    description: "约 1 分钟，采集双向 TCP/UDP、空载和负载 RTT。"
  },
  {
    id: "standard-acceptance",
    label: "标准测试",
    description: "约 4 分钟，采集双向 TCP/UDP、负载延迟与吞吐趋势。"
  },
  {
    id: "video-meeting",
    label: "视频会议速率测试",
    description: "采集双向 TCP，并以 4 Mbps 进行 3 分钟 双向 UDP 测试（每方向 3 分钟）。"
  },
  {
    id: "hd-video",
    label: "高清视频速率测试",
    description: "采集双向 TCP，并以 25 Mbps 进行 3 分钟 双向 UDP 测试（每方向 3 分钟）。"
  },
  {
    id: "long-stability",
    label: "长时间稳定性测试",
    description: "每方向 30 分钟、8 Mbps UDP 测试，记录吞吐波动和丢包。"
  }
];

const PHASE_LABELS: Record<TestPhase["kind"], string> = {
  connectivity: "连通性检查",
  latency: "延迟采样",
  "tcp-upload": "TCP 上行吞吐量",
  "tcp-download": "TCP 下行吞吐量",
  "udp-quality": "UDP 上行质量",
  "udp-download": "UDP 下行质量"
};

const RUN_MODES: TestPlan["runMode"][] = ["single", "separate", "concurrent"];

export function listTestSuites(): TestSuiteDefinition[] {
  return TEST_SUITES.map((suite) => ({ ...suite }));
}

export function buildTestPlan(
  suiteId: TestSuiteId,
  runMode: TestPlan["runMode"],
  options: BuildPlanOptions = {}
): TestPlan {
  const suite = TEST_SUITES.find((candidate) => candidate.id === suiteId);

  if (!suite) {
    throw new Error(`Unknown test suite: ${suiteId}`);
  }

  validateRunMode(runMode);
  validateDuration(options.durationSeconds);

  return {
    suiteId,
    label: suite.label,
    phases: buildPhases(suiteId, options),
    runMode
  };
}

function validateRunMode(runMode: TestPlan["runMode"]): void {
  if (!RUN_MODES.includes(runMode)) {
    throw new Error(`Invalid run mode: ${runMode}`);
  }
}

function validateDuration(durationSeconds: BuildPlanOptions["durationSeconds"]): void {
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
    throw new Error(`Invalid duration: ${durationSeconds}`);
  }
}

function buildPhases(suiteId: TestSuiteId, options: BuildPlanOptions): TestPhase[] {
  switch (suiteId) {
    case "quick-check":
      return commonPhases(10, 20, 8);
    case "standard-acceptance":
      return commonPhases(30, 60, 30);
    case "video-meeting":
      return commonPhases(30, 45, 180, 4);
    case "hd-video":
      return commonPhases(30, 60, 180, 25);
    case "long-stability":
      return commonPhases(60, 120, options.durationSeconds ?? 1800, 8);
    default:
      throw new Error(`Unknown test suite: ${suiteId}`);
  }
}

function commonPhases(
  latencySeconds: number,
  tcpSeconds: number,
  udpSeconds: number,
  targetBitrateMbps = 8
): TestPhase[] {
  return [
    phase("connectivity", 5),
    phase("latency", latencySeconds),
    phase("tcp-upload", tcpSeconds),
    phase("tcp-download", tcpSeconds),
    phase("udp-quality", udpSeconds, targetBitrateMbps),
    phase("udp-download", udpSeconds, targetBitrateMbps)
  ];
}

function phase(
  kind: TestPhase["kind"],
  durationSeconds: number,
  targetBitrateMbps?: number
): TestPhase {
  return {
    id: kind,
    kind,
    label: PHASE_LABELS[kind],
    durationSeconds,
    ...(targetBitrateMbps === undefined ? {} : { targetBitrateMbps })
  };
}
