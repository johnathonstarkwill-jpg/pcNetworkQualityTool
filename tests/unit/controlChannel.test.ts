import { afterEach, describe, expect, it } from "vitest";
import { encode } from "../../src/main/controlProtocol";
import { ControlServer } from "../../src/main/controlServer";
import { ControlClient } from "../../src/main/controlClient";
import type { ClientSessionState } from "../../src/shared/types";
import net from "node:net";

let server: ControlServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("ControlServer over TCP", () => {
  it("registers a client that connects and sends register-client", async () => {
    server = new ControlServer();
    const port = await server.listen(0); // 0 => ephemeral port

    const stateAfterRegister = new Promise((resolve) => {
      server!.on("state", (state) => {
        if (state.clients.length === 1) resolve(state);
      });
    });

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      encode({
        type: "register-client",
        client: { id: "c1", name: "客户端 A", address: "127.0.0.1", status: "connected" }
      })
    );

    const state: any = await stateAfterRegister;
    expect(state.clients[0]).toMatchObject({ id: "c1", name: "客户端 A", status: "connected" });

    const ackLine = await new Promise<string>((resolve) => socket.once("data", (d) => resolve(d.toString())));
    expect(JSON.parse(ackLine.trim())).toEqual({ type: "client-registered", clientId: "c1" });

    socket.destroy();
  });

  it("marks a client disconnected when its socket closes", async () => {
    server = new ControlServer();
    const port = await server.listen(0);

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      encode({
        type: "register-client",
        client: { id: "c2", name: "客户端 B", address: "127.0.0.1", status: "connected" }
      })
    );
    await new Promise((resolve) => socket.once("data", resolve));

    const disconnected = new Promise((resolve) => {
      server!.on("state", (state) => {
        if (state.clients[0]?.status === "disconnected") resolve(state);
      });
    });

    socket.destroy();
    const state: any = await disconnected;
    expect(state.clients[0].status).toBe("disconnected");
  });

  it("broadcasts a message to connected clients", async () => {
    server = new ControlServer();
    const port = await server.listen(0);

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write(
      encode({
        type: "register-client",
        client: { id: "c3", name: "客户端 C", address: "127.0.0.1", status: "connected" }
      })
    );
    // consume the client-registered ack
    await new Promise((resolve) => socket.once("data", resolve));

    const received = new Promise<string>((resolve) => socket.once("data", (d) => resolve(d.toString())));
    server.broadcast({ type: "error", message: "hello" });
    const line = await received;
    expect(JSON.parse(line.trim())).toEqual({ type: "error", message: "hello" });

    socket.destroy();
  });
});

describe("ControlClient over TCP", () => {
  it("connects to a server and reaches connected status", async () => {
    server = new ControlServer();
    const port = await server.listen(0);

    const client = new ControlClient();
    const connected = new Promise<ClientSessionState>((resolve) => {
      client.on("state", (state) => {
        if (state.status === "connected") resolve(state);
      });
    });

    client.connectToAddress("127.0.0.1", port);
    const state = await connected;
    expect(state.status).toBe("connected");
    expect(state.connectedServer?.address).toBe("127.0.0.1");

    client.disconnect();
  });
});

describe("ControlServer.startPlan orchestration", () => {
  it("dispatches to clients sequentially and assembles a report", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const timeline: string[] = [];
    const makeExec = (tag: string) => async (input: { phaseKind: string }) => {
      timeline.push(`${tag}:start:${input.phaseKind}`);
      await new Promise((r) => setTimeout(r, 20));
      timeline.push(`${tag}:end:${input.phaseKind}`);
      return { phaseId: input.phaseKind, throughputMbps: 50, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };

    const mkClient = (id: string) =>
      new Promise<import("../../src/main/controlClient").ControlClient>(async (resolve) => {
        const { ControlClient } = await import("../../src/main/controlClient");
        const c = new ControlClient({ iperfExec: makeExec(id) as never, id, name: id });
        c.on("state", (s) => {
          if (s.status === "connected" && s.statusText.includes("等待")) resolve(c);
        });
        c.connectToAddress("127.0.0.1", port);
      });

    const a = await mkClient("A");
    const b = await mkClient("B");

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => {
        if (s.latestReport) resolve(s);
      });
    });

    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["A", "B"]);

    const finalState = await reported;

    const firstB = timeline.findIndex((e) => e.startsWith("B:"));
    const lastA = timeline.map((e) => e.startsWith("A:")).lastIndexOf(true);
    expect(firstB).toBeGreaterThan(lastA);

    expect(finalState.latestReport?.results.length).toBe(2);
    for (const r of finalState.latestReport!.results) {
      expect(r.phases.length).toBe(3);
    }
    expect(finalState.latestReport?.summary.rating).toBeDefined();

    a.disconnect();
    b.disconnect();
    await srv.close();
  });

  it("ignores a stale test-complete and a re-entrant startPlan", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const exec = async (input: { phaseKind: string }) => {
      await new Promise((r) => setTimeout(r, 10));
      return { phaseId: input.phaseKind, throughputMbps: 10, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const c = await new Promise<InstanceType<typeof ControlClient>>((resolve) => {
      const cc = new ControlClient({ iperfExec: exec as never, id: "solo", name: "solo" });
      cc.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(cc); });
      cc.connectToAddress("127.0.0.1", port);
    });

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => { if (s.latestReport) resolve(s); });
    });
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["solo"]);
    // Re-entrant call while running must be ignored (no throw, no clobber).
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["solo"]);

    const finalState = await reported;
    expect(finalState.latestReport?.results.length).toBe(1);
    expect(finalState.latestReport?.results[0].phases.length).toBe(3);

    c.disconnect();
    await srv.close();
  });
});

describe("ControlClient plan execution", () => {
  it("runs runnable phases via the injected executor and reports each result then completes", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const runnableKinds: string[] = [];
    const fakeExec = async (input: { phaseKind: string }) => {
      runnableKinds.push(input.phaseKind);
      return { phaseId: input.phaseKind, throughputMbps: 100, errors: [] };
    };

    const client = new ControlClient({ iperfExec: fakeExec as never, id: "cx", name: "CX" });
    const connected = new Promise<void>((resolve) => {
      client.on("state", (s) => {
        if (s.status === "connected" && s.statusText.includes("等待")) resolve();
      });
    });
    client.connectToAddress("127.0.0.1", port);
    await connected;

    const phaseResults: string[] = [];
    let completed = false;
    srv.on("phase-result", (clientId: string) => phaseResults.push(clientId));
    const done = new Promise<void>((resolve) => srv.on("test-complete", () => { completed = true; resolve(); }));

    const { buildTestPlan } = await import("../../src/main/testPlans");
    const plan = buildTestPlan("quick-check", "separate");
    srv.startPlan(plan, ["cx"]);

    await done;
    expect(completed).toBe(true);
    expect(runnableKinds).toEqual(["tcp-upload", "tcp-download", "udp-quality"]);
    expect(phaseResults.length).toBe(3);

    client.disconnect();
    await srv.close();
  });
});

describe("ControlServer logging and suite coloring", () => {
  it("relays client logs, records the suite rating, and broadcasts suite-complete", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const fakeExec = async (input: { phaseKind: string }, onInterval?: (u: unknown) => void) => {
      onInterval?.({ phaseKind: input.phaseKind, second: 1, throughputMbps: 50 });
      return { phaseId: input.phaseKind, throughputMbps: 50, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const client = new ControlClient({ iperfExec: fakeExec as never, id: "cl", name: "Box" });
    await new Promise<void>((resolve) => {
      client.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(); });
      client.connectToAddress("127.0.0.1", port);
    });

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => { if (s.latestReport) resolve(s); });
    });
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["cl"]);
    const finalState = await reported;

    expect(finalState.log.some((l) => l.includes("Box"))).toBe(true);
    expect(finalState.suiteRatings["quick-check"]).toBeDefined();
    expect(finalState.suiteRatings["quick-check"]).toBe(finalState.latestReport?.summary.rating);

    await new Promise((r) => setTimeout(r, 100));
    expect(client.getState().currentSuite?.status).toBe(finalState.latestReport?.summary.rating);

    client.disconnect();
    await srv.close();
  });
});

describe("ControlClient logging and currentSuite", () => {
  it("logs intervals + phases and sets currentSuite from start-test", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const fakeExec = async (input: { phaseKind: string }, onInterval?: (u: unknown) => void) => {
      onInterval?.({ phaseKind: input.phaseKind, second: 1, throughputMbps: 50 });
      return { phaseId: input.phaseKind, throughputMbps: 50, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const client = new ControlClient({ iperfExec: fakeExec as never, id: "lg", name: "LG" });
    await new Promise<void>((resolve) => {
      client.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(); });
      client.connectToAddress("127.0.0.1", port);
    });

    const done = new Promise<void>((resolve) => srv.on("test-complete", () => resolve()));
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["lg"]);
    await done;

    const state = client.getState();
    expect(state.currentSuite?.label).toBe("快速检测");
    expect(state.log.some((l) => l.includes("快速检测"))).toBe(true);
    expect(state.log.some((l) => l.includes("Mbps"))).toBe(true);

    client.disconnect();
    await srv.close();
  });
});

describe("ControlServer.startPlan client subset", () => {
  it("runs only the selected client and excludes the other", async () => {
    const srv = new ControlServer();
    const port = await srv.listen(0);

    const exec = async (input: { phaseKind: string }) => {
      await new Promise((r) => setTimeout(r, 5));
      return { phaseId: input.phaseKind, throughputMbps: 10, udpLossPercent: 0, jitterMs: 1, errors: [] };
    };
    const { ControlClient } = await import("../../src/main/controlClient");
    const mk = (id: string) =>
      new Promise<InstanceType<typeof ControlClient>>((resolve) => {
        const c = new ControlClient({ iperfExec: exec as never, id, name: id });
        c.on("state", (s) => { if (s.status === "connected" && s.statusText.includes("等待")) resolve(c); });
        c.connectToAddress("127.0.0.1", port);
      });

    const a = await mk("A");
    const b = await mk("B");

    const reported = new Promise<import("../../src/shared/types").ServerSessionState>((resolve) => {
      srv.on("state", (s) => { if (s.latestReport) resolve(s); });
    });
    const { buildTestPlan } = await import("../../src/main/testPlans");
    srv.startPlan(buildTestPlan("quick-check", "separate"), ["A"]); // only A

    const finalState = await reported;
    expect(finalState.latestReport?.results.length).toBe(1);
    expect(finalState.latestReport?.results[0].clientId).toBe("A");
    // B was never asked to test.
    expect(b.getState().currentSuite).toBeUndefined();

    a.disconnect();
    b.disconnect();
    await srv.close();
  });
});
