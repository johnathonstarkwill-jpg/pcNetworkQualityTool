import { afterEach, describe, expect, it } from "vitest";
import { encode } from "../../src/main/controlProtocol";
import { ControlServer } from "../../src/main/controlServer";
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
});
