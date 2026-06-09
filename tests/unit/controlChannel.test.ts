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
