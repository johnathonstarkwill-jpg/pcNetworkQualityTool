import { afterEach, expect, it } from "vitest";
import { ControlServer } from "../../src/main/controlServer";
import { ControlClient } from "../../src/main/controlClient";
import type { TestPlan } from "../../src/shared/types";
let server: ControlServer;
const clients: ControlClient[] = [];
afterEach(async () => { clients.splice(0).forEach(c => c.disconnect()); await server?.close(); });
const probeExec = async (input: { phaseKind: string }) => ({ phaseId: input.phaseKind, reachable: true, packetsSent: 1, packetsReceived: 1, packetsLost: 0, packetLossPercent: 0, rttSamples: 1, latencyMs: { min: 1, avg: 1, max: 1, p95: 1, p99: 1 }, errors: [] });
async function connect(port: number, id: string, exec: any) {
  const client = new ControlClient({ id, name: id, probeExec, iperfExec: exec }); clients.push(client);
  client.connectToAddress("127.0.0.1", port);
  await expect.poll(() => client.getState().status).toBe("connected");
  return client;
}
it("serializes simultaneous manual requests and ignores repeat clicks", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  let active = 0, maximum = 0;
  const order: string[] = [];
  const executor = (id: string) => async (input: { phaseKind: string }) => {
    active++; maximum = Math.max(maximum, active); order.push(id);
    await new Promise(r => setTimeout(r, 15)); active--;
    return { phaseId: input.phaseKind, throughputMbps: 10, udpLossPercent: 0, jitterMs: 1, packetsSent: 1, packetsLost: 0, errors: [] };
  };
  const a = await connect(port, "a", executor("a")), b = await connect(port, "b", executor("b"));
  await a.runManualTest(); await b.runManualTest(); await b.runManualTest();
  expect(b.getState().status).toBe("queued");
  await expect.poll(() => [a.getState().lastResult?.length, b.getState().lastResult?.length]).toEqual([6, 6]);
  await expect.poll(() => server.getState().activePlan).toBeUndefined();
  expect(maximum).toBe(1);
  expect(order).toEqual(["a", "a", "a", "a", "b", "b", "b", "b"]);
});
it("waits behind a server-started suite and drops disconnected queued clients", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  let finish!: () => void;
  const executionStarted: string[] = [];
  const a = await connect(port, "a", async (input: { phaseKind: string }) => {
    executionStarted.push("a"); await new Promise<void>(r => { finish = r; });
    return { phaseId: input.phaseKind, throughputMbps: 10, errors: [] };
  });
  const b = await connect(port, "b", async (input: { phaseKind: string }) => { executionStarted.push("b"); return { phaseId: input.phaseKind, throughputMbps: 10, errors: [] }; });
  const plan: TestPlan = { suiteId: "quick-check", label: "server", runMode: "separate", phases: [{ id: "tcp-upload", kind: "tcp-upload", label: "TCP", durationSeconds: 1 }] };
  server.startPlan(plan, ["a"]);
  await expect.poll(() => executionStarted.length).toBe(1);
  await b.runManualTest();
  await expect.poll(() => b.getState().statusText).toContain("已排队");
  b.disconnect();
  await expect.poll(() => server.getState().clients.find(c => c.id === "b")?.status).toBe("disconnected");
  finish();
  await expect.poll(() => server.getState().activePlan).toBeUndefined();
  expect(executionStarted).toEqual(["a"]);
  expect(a.getState().lastResult).toHaveLength(1);
});
it("queues a manual request behind another client's server-started suite", async () => {
  server = new ControlServer(); const port = await server.listen(0);
  let finish!: () => void; const order: string[] = [];
  await connect(port, "a", async (input: { phaseKind: string }) => { order.push("a"); await new Promise<void>(r => { finish = r; }); return { phaseId: input.phaseKind, throughputMbps: 10, errors: [] }; });
  const b = await connect(port, "b", async (input: { phaseKind: string }) => { order.push("b"); return { phaseId: input.phaseKind, throughputMbps: 10, udpLossPercent: 0, jitterMs: 1, packetsSent: 1, packetsLost: 0, errors: [] }; });
  server.startPlan({ suiteId: "quick-check", label: "server", runMode: "separate", phases: [{ id: "tcp-upload", kind: "tcp-upload", label: "TCP", durationSeconds: 1 }] }, ["a"]);
  await expect.poll(() => order.length).toBe(1);
  await b.runManualTest(); await expect.poll(() => b.getState().statusText).toContain("已排队");
  expect(order).toEqual(["a"]); finish();
  await expect.poll(() => b.getState().lastResult?.length).toBe(6);
  expect(order).toEqual(["a", "b", "b", "b", "b"]);
});

it("does not bypass scheduling when connected to an older server", async () => {
  const net = await import("node:net");
  let executed = false;
  const legacy = net.createServer(socket => socket.once("data", raw => {
    const registration = JSON.parse(raw.toString().trim());
    socket.write(JSON.stringify({ type: "client-registered", clientId: registration.client.id }) + '\n');
  }));
  await new Promise<void>(r => legacy.listen(0, "127.0.0.1", r));
  const address = legacy.address(); if (!address || typeof address === "string") throw new Error("missing port");
  const client = await connect(address.port, "legacy-client", async () => { executed = true; return { phaseId: "tcp-upload", errors: [] }; });
  try {
    await client.runManualTest();
    expect(executed).toBe(false);
    expect(client.getState().status).toBe("connected");
    expect(client.getState().statusText).toContain("更新服务端");
  } finally { client.disconnect(); await new Promise<void>(r => legacy.close(() => r())); }
});
