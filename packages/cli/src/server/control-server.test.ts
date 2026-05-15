import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import { type HostPort, parseHostPort } from "#app/lib/address.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import { startControlServer } from "#app/server/control-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const openWebSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const nextMessage = async (socket: WebSocket) => {
  const data = await new Promise<RawData>((resolve) => {
    socket.once("message", resolve);
  });

  if (Buffer.isBuffer(data)) {
    return decodeFrame(data);
  }

  if (Array.isArray(data)) {
    return decodeFrame(Buffer.concat(data));
  }

  return decodeFrame(Buffer.from(new Uint8Array(data)));
};

const waitForClose = async (socket: WebSocket) => {
  await new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
  });
};

describe("control server", () => {
  const handles: Array<{ close(): Promise<void> }> = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(
      sockets.splice(0).map(async (socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
        await waitForClose(socket);
      }),
    );
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it("registers a client and replies with a registered frame", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", name: "demo" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      name: "demo",
    });
    expect(registry.get("demo")?.name).toBe("demo");
  });

  it("rejects registration with a mismatched token", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
      token: "expected-token",
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });

    socket.send(
      encodeFrame({ type: "register", name: "demo", token: "wrong-token" }),
    );

    await expect(close).resolves.toEqual({
      code: 1008,
      reason: "Invalid tunnel token",
    });
    expect(registry.get("demo")).toBeUndefined();
  });

  it("rejects duplicate tunnel names", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);
    const firstSocket = await openWebSocket(handle.url);
    const secondSocket = await openWebSocket(handle.url);
    sockets.push(firstSocket, secondSocket);

    firstSocket.send(encodeFrame({ type: "register", name: "demo" }));
    await nextMessage(firstSocket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      secondSocket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });
    secondSocket.send(encodeFrame({ type: "register", name: "demo" }));

    await expect(nextMessage(secondSocket)).resolves.toEqual({
      type: "error",
      streamId: "registration",
      message: 'Tunnel "demo" is already registered',
    });
    await expect(close).resolves.toEqual({
      code: 1008,
      reason: 'Tunnel "demo" is already registered',
    });
    expect(registry.get("demo")?.connection).toBeDefined();
  });

  it("unregisters a tunnel when the client disconnects", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", name: "demo" }));
    await nextMessage(socket);
    socket.close();
    await waitForClose(socket);

    expect(registry.get("demo")).toBeUndefined();
  });

  it("returns the listening control URL", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);

    const parsedAddress = parseHostPort(handle.url.replace("ws://", ""));
    expect(parsedAddress.host).toBe("127.0.0.1");
    expect(parsedAddress.port).toBeGreaterThan(0);
  });
});
