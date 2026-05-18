import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import { createLocalWebSocketEchoServer } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const basic = (value: string): string => {
  return `Basic ${Buffer.from(value).toString("base64")}`;
};

const openWebSocket = async (
  url: string,
  headers: Record<string, string> = {},
): Promise<WebSocket> => {
  const socket = new WebSocket(url, {
    headers: { host: "demo.localhost", ...headers },
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return socket;
};

const expectWebSocketOpenFailure = async (url: string): Promise<void> => {
  const socket = new WebSocket(url, { headers: { host: "demo.localhost" } });

  await expect(
    new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
  ).rejects.toThrow("Unexpected server response: 401");
};

const waitForMessage = async (
  socket: WebSocket,
): Promise<{ readonly data: Buffer; readonly isBinary: boolean }> => {
  return await new Promise((resolve, reject) => {
    socket.once("message", (data, isBinary) => {
      resolve({ data: Buffer.from(data as Buffer), isBinary });
    });
    socket.once("error", reject);
  });
};

const waitForClose = async (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const createDeterministicBuffer = (size: number): Buffer => {
  const payload = Buffer.allocUnsafe(size);

  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + 17) % 256;
  }

  return payload;
};

describe("WebSocket tunnel integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("proxies text and binary websocket messages through the full tunnel", async () => {
    let resolveLocalConnectionClosed: () => void = () => {};
    const localConnectionClosed = new Promise<void>((resolve) => {
      resolveLocalConnectionClosed = resolve;
    });
    const localWebSocketServer = await createLocalWebSocketEchoServer({
      onConnectionClosed() {
        resolveLocalConnectionClosed();
      },
    });
    cleanups.push(() => localWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localWebSocketServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );
    const publicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (publicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          publicSocket.once("close", () => resolve());
          publicSocket.close();
        }),
    );

    publicSocket.send("hello");
    const textMessage = await waitForMessage(publicSocket);
    expect(textMessage.isBinary).toBe(false);
    expect(textMessage.data.toString("utf8")).toBe("hello");

    publicSocket.send(Buffer.from([1, 2, 3]));
    const binaryMessage = await waitForMessage(publicSocket);
    expect(binaryMessage.isBinary).toBe(true);
    expect(binaryMessage.data).toEqual(Buffer.from([1, 2, 3]));

    publicSocket.close();
    await waitForClose(publicSocket);
    await localConnectionClosed;
  });

  it("opens websocket tunnels through an auto-assigned subdomain", async () => {
    const localWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => localWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localWebSocketServer.port,
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );
    const publicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`, {
      host: `${tunnelClient.subdomain}.localhost`,
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (publicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          publicSocket.once("close", () => resolve());
          publicSocket.close();
        }),
    );

    publicSocket.send("hello-auto");
    const message = await waitForMessage(publicSocket);

    expect(message.isBinary).toBe(false);
    expect(message.data.toString("utf8")).toBe("hello-auto");
  });

  it("requires public basic auth before opening websocket tunnels", async () => {
    const localWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => localWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      basicAuth: { password: "site-secret" },
      localPort: localWebSocketServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );

    await expectWebSocketOpenFailure(`${publicWebSocketUrl}/echo`);

    const publicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`, {
      authorization: basic("anything:site-secret"),
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (publicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          publicSocket.once("close", () => resolve());
          publicSocket.close();
        }),
    );

    publicSocket.send("hello");
    const message = await waitForMessage(publicSocket);

    expect(message.isBinary).toBe(false);
    expect(message.data.toString("utf8")).toBe("hello");
  });

  it("isolates concurrent public websocket connections over one tunnel", async () => {
    const localWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => localWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localWebSocketServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );
    const publicSockets = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        openWebSocket(`${publicWebSocketUrl}/echo/${index}`),
      ),
    );
    for (const socket of publicSockets) {
      cleanups.push(
        () =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            socket.once("close", () => resolve());
            socket.close();
          }),
      );
    }

    const textMessages = publicSockets.map((socket, index) => ({
      expected: `socket-${index}:text`,
      socket,
    }));
    for (const { expected, socket } of textMessages) {
      socket.send(expected);
    }
    const textResponses = await Promise.all(
      textMessages.map(async ({ expected, socket }) => ({
        expected,
        response: await waitForMessage(socket),
      })),
    );

    for (const { expected, response } of textResponses) {
      expect(response.isBinary).toBe(false);
      expect(response.data.toString("utf8")).toBe(expected);
    }

    const binaryMessages = publicSockets.map((socket, index) => ({
      expected: Buffer.from(`socket-${index}:binary`),
      socket,
    }));
    for (const { expected, socket } of binaryMessages) {
      socket.send(expected);
    }
    const binaryResponses = await Promise.all(
      binaryMessages.map(async ({ expected, socket }) => ({
        expected,
        response: await waitForMessage(socket),
      })),
    );

    for (const { expected, response } of binaryResponses) {
      expect(response.isBinary).toBe(true);
      expect(response.data).toEqual(expected);
    }
  });

  it("preserves a large binary websocket payload through the full tunnel", async () => {
    const localWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => localWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localWebSocketServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );
    const publicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (publicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          publicSocket.once("close", () => resolve());
          publicSocket.close();
        }),
    );
    const payload = createDeterministicBuffer(512 * 1024);

    publicSocket.send(payload);
    const response = await waitForMessage(publicSocket);

    expect(response.isBinary).toBe(true);
    expect(response.data).toEqual(payload);
  });

  it("closes an in-flight public websocket on tunnel disconnect and accepts a new websocket after re-registration", async () => {
    const oldLocalWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => oldLocalWebSocketServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const oldTunnelClient = await startHttpTunnelClient({
      localPort: oldLocalWebSocketServer.port,
      reconnectDelayMs: 60_000,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => oldTunnelClient.close());
    const publicWebSocketUrl = proxerServer.publicUrl.replace(
      "http://",
      "ws://",
    );
    const oldPublicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (oldPublicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          oldPublicSocket.once("close", () => resolve());
          oldPublicSocket.close();
        }),
    );

    await oldTunnelClient.close();
    await withTimeout(
      waitForClose(oldPublicSocket),
      1_000,
      "public websocket did not close promptly after tunnel disconnect",
    );

    const newLocalWebSocketServer = await createLocalWebSocketEchoServer();
    cleanups.push(() => newLocalWebSocketServer.close());
    const newTunnelClient = await startHttpTunnelClient({
      localPort: newLocalWebSocketServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => newTunnelClient.close());
    const newPublicSocket = await openWebSocket(`${publicWebSocketUrl}/echo`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (newPublicSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          newPublicSocket.once("close", () => resolve());
          newPublicSocket.close();
        }),
    );

    newPublicSocket.send("after-reconnect");
    const response = await waitForMessage(newPublicSocket);

    expect(response.isBinary).toBe(false);
    expect(response.data.toString("utf8")).toBe("after-reconnect");
  });
});
