export type AppRole = "unset" | "server" | "client";

export type TestSuiteId =
  | "quick-check"
  | "standard-acceptance"
  | "video-meeting"
  | "hd-video"
  | "long-stability";

export type TestPhaseKind = "connectivity" | "latency" | "tcp-upload" | "tcp-download" | "udp-quality" | "udp-download";

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

export interface RttStats { min: number; avg: number; max: number; p95: number; p99: number; }

export interface ThroughputSample {
  startSeconds: number;
  endSeconds: number;
  mbps: number;
  side: "sender" | "receiver";
}

export interface StabilityStats {
  sampleCount: number;
  observedSeconds: number;
  minMbps: number;
  avgMbps: number;
  maxMbps: number;
  stddevMbps: number;
  cvPercent?: number;
  zeroSeconds: number;
  longestZeroSeconds: number;
  zeroEvents: number;
  missingSeconds: number;
}

export interface LoadedLatency {
  latencyMs?: RttStats;
  rttSamples: number;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  packetLossPercent?: number;
  deltaAvgMs?: number;
  deltaP95Ms?: number;
  baselineSamples?: number;
  notes: string[];
  errors: string[];
}

export interface LiveProgress {
  phaseId: string;
  intervals: ThroughputSample[];
}

export interface PhaseMetrics {
  phaseId: string;
  intervals?: ThroughputSample[];
  stability?: StabilityStats;
  loadedLatency?: LoadedLatency;
  throughputSeriesSide?: "sender" | "receiver";
  throughputMbps?: number;
  senderMbps?: number;
  bytesReceived?: number;
  retransmits?: number;
  durationSeconds?: number;
  targetBitrateMbps?: number;
  packetsSent?: number;
  packetsReceived?: number;
  packetsLost?: number;
  packetLossPercent?: number;
  rttSamples?: number;
  rttUpperBoundMs?: number;
  reachable?: boolean;
  notes?: string[];
  udpLossPercent?: number;
  jitterMs?: number;
  latencyMs?: RttStats;
  errors: string[];
}

export interface ClientTestResult {
  serverAddress?: string;
  clientId: string;
  clientName: string;
  phases: PhaseMetrics[];
}

export interface ReportSummary {
  totalPhases: number;
  completedPhases: number;
  incompletePhases: number;
}

export type SuiteStatus = "completed" | "incomplete";

export interface TestReport {
  id: string;
  createdAt: string;
  suiteId: TestSuiteId;
  serverName: string;
  serverAddress: string;
  clients: ConnectedClient[];
  results: ClientTestResult[];
  summary: ReportSummary;
  plan?: TestPlan;
}

export type ControlMessage =
  | { type: "register-client"; client: ConnectedClient }
  | { type: "client-registered"; clientId: string }
  | { type: "start-test"; runId: string; plan: TestPlan; serverAddress: string }
  | { type: "phase-progress"; runId: string; clientId: string; phaseId: string; interval: ThroughputSample }
  | { type: "phase-result"; runId: string; clientId: string; metrics: PhaseMetrics }
  | { type: "test-busy"; runId: string; clientId: string }
  | { type: "test-complete"; runId: string; clientId: string }
  | { type: "log"; clientId: string; line: string }
  | { type: "suite-complete"; suiteId: TestSuiteId; status: SuiteStatus }
  | { type: "cancel-test"; runId: string }
  | { type: "error"; message: string };

export interface ServerSessionState {
  role: "server";
  liveProgress?: LiveProgress;
  clients: ConnectedClient[];
  activePlan?: TestPlan;
  latestReport?: TestReport;
  listening: boolean;
  localAddresses: string[];
  testingClientId?: string;
  log: string[];
  suiteStatuses: Partial<Record<TestSuiteId, SuiteStatus>>;
}

export interface ClientSessionState {
  role: "client";
  liveProgress?: LiveProgress;
  discoveredServers: DiscoveredServer[];
  connectedServer?: DiscoveredServer;
  status: "searching" | "connecting" | "connected" | "testing" | "error";
  statusText: string;
  lastResult?: PhaseMetrics[];
  log: string[];
  currentSuite?: { label: string; status: "running" | SuiteStatus };
}
