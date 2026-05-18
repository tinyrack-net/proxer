import { describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import { startServer } from "#app/services/server.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const createLogger = (): {
  readonly messages: string[];
  info(message: string): void;
  error(message: string): void;
} => {
  const messages: string[] = [];

  return {
    messages,
    info(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
};

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

const nextClose = async (socket: WebSocket) => {
  return await new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString("utf8") }),
    );
  });
};

describe("server service", () => {
  it("generates a strong token when none is configured", async () => {
    const server = await startServer({ listenAddress: randomAddress });
    const token = (server as { readonly token?: string }).token;
    let unauthenticatedSocket: WebSocket | undefined;
    let authenticatedSocket: WebSocket | undefined;

    try {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      unauthenticatedSocket = await openWebSocket(server.controlUrl);
      unauthenticatedSocket.send(encodeFrame({ type: "register" }));
      await expect(nextClose(unauthenticatedSocket)).resolves.toEqual({
        code: 1008,
        reason: "Invalid tunnel token",
      });

      authenticatedSocket = await openWebSocket(server.controlUrl);
      authenticatedSocket.send(encodeFrame({ type: "register", token }));
      await expect(nextMessage(authenticatedSocket)).resolves.toMatchObject({
        subdomain: expect.stringMatching(/^px-/),
        type: "registered",
      });
    } finally {
      unauthenticatedSocket?.close();
      authenticatedSocket?.close();
      await server.close();
    }
  });

  it("passes logger through to control-plane client lifecycle logs", async () => {
    const logger = createLogger();
    const server = await startServer({
      listenAddress: randomAddress,
      logger,
      token: "expected-token",
    });
    let socket: WebSocket | undefined;

    try {
      socket = await openWebSocket(server.controlUrl);
      socket.send(
        encodeFrame({
          type: "register",
          subdomain: "demo",
          token: "expected-token",
        }),
      );
      await expect(nextMessage(socket)).resolves.toEqual({
        type: "registered",
        subdomain: "demo",
      });

      expect(logger.messages).toEqual([
        expect.stringContaining("[demo] client connected route=subdomain"),
      ]);
    } finally {
      socket?.close();
      await server.close();
    }
  });
});
