import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import { createLocalWebSocketEchoServer } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const openWebSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url, { headers: { host: "demo.localhost" } });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return socket;
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
      serverUrl: proxerServer.controlUrl,
      subdomain: "demo",
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
});
