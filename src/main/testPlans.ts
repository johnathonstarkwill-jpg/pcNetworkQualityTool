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
    description: "1-2 分钟，快速发现明显网络问题。"
  },
  {
    id: "standard-acceptance",
    label: "标准验收",
    description: "5-8 分钟，生成正式验收报告。"
  },
  {
    id: "video-meeting",
    label: "视频会议模拟",
    description: "模拟实时音视频会议。"
  },
  {
    id: "hd-video",
    label: "高清视频传输模拟",
    description: "模拟 1080p/4K 持续视频流。"
  },
  {
    id: "long-stability",
    label: "长时间稳定性测试",
    description: "发现间歇性丢包和波动。"
  }
];

const PHASE_LABELS: Record<TestPhase["kind"], string> = {
  connectivity: "连通性检查",
  latency: "延迟测试",
  "tcp-upload": "TCP 上传",
  "tcp-download": "TCP 下载",
  "udp-quality": "UDP 质量"
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
    phase("udp-quality", udpSeconds, targetBitrateMbps)
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
