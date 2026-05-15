import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { attachLocalWebSocketForwarder } from "#app/client/local-websocket-forwarder.ts";
import type { DataFrame, TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";

class FakeTunnelConnection implements TunnelConnection {
  readonly sent: TunnelFrame[] = [];
  readonly #frameListeners = new Set<(frame: TunnelFrame) => void>();
  readonly #sentWaiters: Array<{
    readonly predicate: (frame: TunnelFrame) => boolean;
    readonly resolve: (frame: TunnelFrame) => void;
  }> = [];

  async send(frame: TunnelFrame): Promise<void> {
    this.sent.push(frame);
    const waiterIndex = this.#sentWaiters.findIndex((waiter) =>
      waiter.predicate(frame),
    );
    if (waiterIndex !== -1) {
      const waiter = this.#sentWaiters.splice(waiterIndex, 1)[0];
      waiter?.resolve(frame);
    }
  }

  async close(): Promise<void> {}

  onFrame(listener: (frame: TunnelFrame) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  onClose(): () => void {
    return () => {};
  }

  emitFrame(frame: TunnelFrame): void {
    for (const listener of this.#frameListeners) {
      listener(frame);
    }
  }

  waitForSentFrame(
    predicate: (frame: TunnelFrame) => boolean,
  ): Promise<TunnelFrame> {
    const existingFrame = this.sent.find(predicate);
    if (existingFrame) {
      return Promise.resolve(existingFrame);
    }

    return new Promise((resolve) => {
      this.#sentWaiters.push({ predicate, resolve });
    });
  }
}

const listenOnRandomPort = async (server: net.Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("server did not bind to TCP");
  }
  return address.port;
};

const closeServer = async (server: net.Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe("local WebSocket forwarder", () => {
  const cleanups: Array<() => void> = [];
  const servers: net.Server[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("replays the websocket upgrade request and proxies raw socket bytes", async () => {
    const observedRequests: string[] = [];
    const localServer = net.createServer((socket) => {
      let upgradeComplete = false;
      let buffered = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        if (!upgradeComplete) {
          buffered = Buffer.concat([buffered, chunk]);
          const headerEnd = buffered.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            return;
          }

          observedRequests.push(buffered.subarray(0, headerEnd + 4).toString());
          upgradeComplete = true;
          socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
          const remainder = buffered.subarray(headerEnd + 4);
          if (remainder.length === 0) {
            return;
          }
          socket.write(Buffer.concat([Buffer.from("local:"), remainder]));
          return;
        }

        socket.write(Buffer.concat([Buffer.from("local:"), chunk]));
      });
    });
    servers.push(localServer);
    const port = await listenOnRandomPort(localServer);
    const connection = new FakeTunnelConnection();
    cleanups.push(
      attachLocalWebSocketForwarder({ connection, localPort: port }),
    );

    connection.emitFrame({
      headers: {
        connection: "Upgrade",
        host: "demo.localhost",
        upgrade: "websocket",
      },
      kind: "websocket",
      method: "GET",
      path: "/chat",
      streamId: "stream-1",
      type: "open",
    });

    const upgradeResponseFrame = await connection.waitForSentFrame(
      (frame): frame is DataFrame =>
        frame.type === "data" &&
        frame.direction === "response" &&
        Buffer.from(frame.data, "base64").toString("utf8") ===
          "HTTP/1.1 101 Switching Protocols\r\n\r\n",
    );
    expect(upgradeResponseFrame).toMatchObject({ streamId: "stream-1" });
    expect(observedRequests[0]).toBe(
      "GET /chat HTTP/1.1\r\n" +
        "connection: Upgrade\r\n" +
        "host: demo.localhost\r\n" +
        "upgrade: websocket\r\n" +
        "\r\n",
    );

    connection.emitFrame({
      data: Buffer.from("client-bytes").toString("base64"),
      direction: "request",
      streamId: "stream-1",
      type: "data",
    });

    const echoedFrame = await connection.waitForSentFrame(
      (frame): frame is DataFrame =>
        frame.type === "data" &&
        frame.direction === "response" &&
        Buffer.from(frame.data, "base64").toString("utf8") ===
          "local:client-bytes",
    );
    expect(echoedFrame).toMatchObject({ streamId: "stream-1" });
  });
});
