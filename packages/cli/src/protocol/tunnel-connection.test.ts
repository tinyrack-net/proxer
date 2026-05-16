import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import { encodeFrame } from "#app/protocol/frame-codec.ts";
import { createWebSocketTunnelConnection } from "#app/protocol/tunnel-connection.ts";

class FakeWebSocket extends EventEmitter {
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  readyState: number = WebSocket.OPEN;

  send(data: string, callback?: (error?: Error) => void) {
    this.sent.push(data);
    callback?.();
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }

    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

const asWebSocket = (socket: FakeWebSocket): WebSocket => {
  return socket as unknown as WebSocket;
};

describe("WebSocket tunnel connection", () => {
  it("encodes frames when sending", async () => {
    const socket = new FakeWebSocket();
    const connection = createWebSocketTunnelConnection(asWebSocket(socket));

    await connection.send({ type: "registered", subdomain: "demo" });

    expect(socket.sent).toEqual([
      encodeFrame({ type: "registered", subdomain: "demo" }),
    ]);
  });

  it("decodes incoming messages into frame listeners", () => {
    const socket = new FakeWebSocket();
    const connection = createWebSocketTunnelConnection(asWebSocket(socket));
    const frames: TunnelFrame[] = [];

    connection.onFrame((frame) => frames.push(frame));
    socket.emit(
      "message",
      encodeFrame({ type: "registered", subdomain: "demo" }),
    );

    expect(frames).toEqual([{ type: "registered", subdomain: "demo" }]);
  });

  it("closes with a protocol error code for invalid incoming frames", () => {
    const socket = new FakeWebSocket();
    createWebSocketTunnelConnection(asWebSocket(socket));

    socket.emit("message", JSON.stringify({ type: "ping" }));

    expect(socket.closeCalls).toEqual([
      { code: 1002, reason: "Invalid tunnel frame" },
    ]);
  });

  it("closes the underlying socket", async () => {
    const socket = new FakeWebSocket();
    const connection = createWebSocketTunnelConnection(asWebSocket(socket));

    await connection.close(1000, "done");

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: "done" }]);
  });

  it("resolves close when the underlying socket is already closed", async () => {
    const socket = new FakeWebSocket();
    socket.readyState = WebSocket.CLOSED;
    const connection = createWebSocketTunnelConnection(asWebSocket(socket));

    await expect(connection.close()).resolves.toBeUndefined();

    expect(socket.closeCalls).toEqual([]);
  });

  it("removes frame and close listeners", () => {
    const socket = new FakeWebSocket();
    const connection = createWebSocketTunnelConnection(asWebSocket(socket));
    const frames: TunnelFrame[] = [];
    const closeErrors: Array<Error | undefined> = [];

    const removeFrameListener = connection.onFrame((frame) =>
      frames.push(frame),
    );
    const removeCloseListener = connection.onClose((error) =>
      closeErrors.push(error),
    );

    removeFrameListener();
    removeCloseListener();
    socket.emit(
      "message",
      encodeFrame({ type: "registered", subdomain: "demo" }),
    );
    socket.emit("error", new Error("boom"));
    socket.emit("close");

    expect(frames).toEqual([]);
    expect(closeErrors).toEqual([]);
  });
});
