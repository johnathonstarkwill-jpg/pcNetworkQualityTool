export type AppRole = "unset" | "server" | "client";

export type TestSuiteId =
  | "quick-check"
  | "standard-acceptance"
  | "video-meeting"
  | "hd-video"
  | "long-stability";

export type TestPhaseKind = "connectivity" | "latency" | "tcp-upload" | "tcp-download" | "udp-quality";

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
  port: number;
  lastSeenAt: number;
}

export interface ConnectedClient {
  id: string;
  name: string;
  address: string;
  status: "connected" | "testing" | "disconnected";
}

export interface TestPhase {
  id: string;
  kind: TestPhaseKind;
  label: string;
  durationSeconds: number;
  targetBitrateMbps?: number;
}

export interface TestPlan {
  suiteId: TestSuiteId;
  label: string;
  phases: TestPhase[];
  runMode: "single" | "separate" | "concurrent";
}

export interface PhaseMetrics {
  phaseId: string;
  throughputMbps?: number;
  udpLossPercent?: number;
  jitterMs?: number;
  latencyMs?: {
    min: number;
    avg: number;
    max: number;
    p95: number;
    p99: number;
  };
  errors: string[];
}

export interface ClientTestResult {
  clientId: string;
  clientName: string;
  phases: PhaseMetrics[];
}

export interface ReportSummary {
  rating: "优秀" | "合格" | "风险" | "不合格";
  conclusion: string;
  recommendation: string;
}

export interface TestReport {
  id: string;
  createdAt: string;
  suiteId: TestSuiteId;
  serverName: string;
  serverAddress: string;
  clients: ConnectedClient[];
  results: ClientTestResult[];
  summary: ReportSummary;
}
