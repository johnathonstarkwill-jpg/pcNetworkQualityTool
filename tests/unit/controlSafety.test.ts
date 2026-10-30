import { afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import net from "node:net";
import { ControlServer } from "../../src/main/controlServer";
import { ControlClient } from "../../src/main/controlClient";
import { createDecoder, encode } from "../../src/main/controlProtocol";
import type { ControlMessage, TestPlan, PhaseMetrics } from "../../src/shared/types";

vi.mock("../../src/main/netInfo", () => ({ listLocalIpv4Addresses: () => ["192.0.2.99"] }));
const plan: TestPlan = { suiteId: "quick-check", label: "test", runMode: "separate", phases: [
  { id: "tcp-upload", kind: "tcp-upload", label: "TCP", durationSeconds: 1 }
] };
let server: ControlServer;
const sockets: net.Socket[] = [];
afterEach(async () => { vi.useRealTimers(); sockets.forEach(s => s.destroy()); sockets.length = 0; await server?.close(); });
async function register(port: number, id: string) {
  const socket = net.connect(port, "127.0.0.1");
  sockets.push(socket);
  const messages: ControlMessage[] = [];
  const decode = createDecoder();
  socket.on("data", data => messages.push(...decode(data.toString())));
  await once(socket, "connect");
  const ack = once(socket, "data");
  socket.write(encode({ type: "register-client", client: { id, name: id, address: "192.0.2.123", status: "connected" } }));
  await ack;
  return { socket, messages };
}
it("binds results to socket identity and run, and targets the connected interface", async () => {
  server = new ControlServer();
  const port = await server.listen(0);
  const a = await register(port, "a"), b = await register(port, "b");
  server.startPlan(plan, ["a"]);
  await expect.poll(() => a.messages.find(m => m.type === "start-test")).toBeDefined();
  const start = a.messages.find(m => m.type === "start-test")!;
  if (start.type !== "start-test") throw new Error("missing plan");
  expect(start.serverAddress).toBe("127.0.0.1");
  expect(server.getState().clients[0].address).toBe("127.0.0.1");
  b.socket.write('null\n{"type":"register-client"}\n');
  b.socket.write(encode({ type: "phase-result", runId: start.runId, clientId: "a", metrics: { phaseId: "tcp-upload", throughputMbps: 999, errors: [] } }));
  b.socket.write(encode({ type: "test-complete", runId: start.runId, clientId: "a" }));
  a.socket.write(encode({ type: "phase-result", runId: "old-run", clientId: "a", metrics: { phaseId: "tcp-upload", throughputMbps: 888, errors: [] } }));
  a.socket.write(encode({ type: "test-complete", runId: "old-run", clientId: "a" }));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(server.getState().testingClientId).toBe("a");
  expect(server.getLatestReport()).toBeUndefined();
  a.socket.write(encode({ type: "test-complete", runId: start.runId, clientId: "a" }));
  await expect.poll(() => server.getLatestReport()).toBeDefined();
  const report = server.getLatestReport()!;
  expect(report.summary).toEqual({ totalPhases: 1, completedPhases: 0, incompletePhases: 1 });
  expect(report.results[0].phases[0].throughputMbps).toBeUndefined();
  expect(report.clients.map(c => c.id)).toEqual(["a"]);
});
it("retains all selected clients and missing phases after disconnect", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  const a = await register(port, "a"), b = await register(port, "b");
  server.startPlan(plan, ["a", "b"]);
  b.socket.destroy();
  await expect.poll(() => server.getState().clients.find(c => c.id === "b")?.status).toBe("disconnected");
  a.socket.destroy();
  await expect.poll(() => server.getLatestReport()).toBeDefined();
  expect(server.getLatestReport()?.results).toHaveLength(2);
  expect(server.getLatestReport()?.summary.incompletePhases).toBe(2);
});
it("cancels a timed out run and records missing data", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  const a = await register(port, "a");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  server.startPlan(plan, ["a"]);
  vi.advanceTimersByTime(46_001);
  expect(server.getLatestReport()?.summary.incompletePhases).toBe(1);
  vi.useRealTimers();
  await expect.poll(() => a.messages.some(m => m.type === "cancel-test")).toBe(true);
});
it("closes unregistered sockets and resets an active plan for reuse", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  await register(port, "a");
  const unknown = net.connect(port, "127.0.0.1"); sockets.push(unknown);
  await once(unknown, "connect");
  server.startPlan(plan, ["a"]);
  await server.close();
  expect(server.getState().activePlan).toBeUndefined();
  expect(server.getState().testingClientId).toBeUndefined();
  expect(await server.listen(0)).toBeGreaterThan(0);
});
it("aborts execution on disconnect and ignores a late executor result", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  let signal: AbortSignal | undefined;
  let finish!: (m: PhaseMetrics) => void;
  const client = new ControlClient({ id: "c", iperfExec: async input => {
    signal = input.signal;
    return new Promise<PhaseMetrics>(resolve => { finish = resolve; });
  } });
  const connected = once(client, "state");
  client.connectToAddress("127.0.0.1", port); await connected;
  await expect.poll(() => client.getState().status).toBe("connected");
  server.startPlan(plan, ["c"]);
  await expect.poll(() => signal).toBeDefined();
  client.disconnect();
  expect(signal?.aborted).toBe(true);
  finish({ phaseId: "tcp-upload", throughputMbps: 10, errors: [] });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(client.getState().status).toBe("searching");
  expect(client.getState().lastResult).toBeUndefined();
});

it("streams long runs without oversized frames and preserves samples when interrupted", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  const a = await register(port, "a");
  server.startPlan(plan, ["a"]);
  await expect.poll(() => a.messages.find(m => m.type === "start-test")).toBeDefined();
  const start = a.messages.find(m => m.type === "start-test")!;
  if (start.type !== "start-test") throw new Error("missing start");
  for (let second = 0; second < 3600; second++) {
    a.socket.write(encode({ type: "phase-progress", runId: start.runId, clientId: "a", phaseId: "tcp-upload", interval: {
      startSeconds: second, endSeconds: second + 1, mbps: second === 100 ? 0 : 10, side: "sender"
    } }));
  }
  await expect.poll(() => server.getState().liveProgress?.intervals.at(-1)?.endSeconds).toBe(3600);
  expect(server.getState().liveProgress?.intervals.length).toBe(120);
  a.socket.write(encode({ type: "test-complete", runId: start.runId, clientId: "a" }));
  await expect.poll(() => server.getLatestReport()).toBeDefined();
  const phase = server.getLatestReport()!.results[0].phases[0];
  expect(phase.intervals).toHaveLength(3600);
  expect(phase.stability).toMatchObject({ zeroEvents: 1, zeroSeconds: 1, missingSeconds: 0, sampleCount: 3600 });
  expect(phase.errors.length).toBeGreaterThan(0); // The final throughput result never arrived.
});
