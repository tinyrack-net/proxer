import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import type { DataFrame, TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

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

const connectRawUpgrade = async (
  url: string,
  host = "demo.localhost",
): Promise<{
  readonly socket: net.Socket;
  readonly waitForData: () => Promise<Buffer>;
}> => {
  const publicUrl = new URL(url);
  const socket = net.connect(Number(publicUrl.port), publicUrl.hostname);
  const dataWaiters: Array<(chunk: Buffer) => void> = [];
  const bufferedChunks: Buffer[] = [];

  socket.on("data", (chunk: Buffer) => {
    const waiter = dataWaiters.shift();
    if (waiter) {
      waiter(Buffer.from(chunk));
      return;
    }

    bufferedChunks.push(Buffer.from(chunk));
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(
    "GET /chat HTTP/1.1\r\n" +
      `Host: ${host}\r\n` +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  return {
    socket,
    waitForData() {
      const bufferedChunk = bufferedChunks.shift();
      if (bufferedChunk) {
        return Promise.resolve(bufferedChunk);
      }

      return new Promise((resolve) => {
        dataWaiters.push(resolve);
      });
    },
  };
};

describe("public WebSocket upgrade tunneling", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("opens a websocket tunnel stream and proxies raw socket bytes", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(handle.url);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (rawClient.socket.destroyed) {
            resolve();
            return;
          }
          rawClient.socket.once("close", () => resolve());
          rawClient.socket.destroy();
        }),
    );
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );

    expect(openFrame).toMatchObject({
      headers: {
        connection: "Upgrade",
        host: "demo.localhost",
        upgrade: "websocket",
      },
      kind: "websocket",
      method: "GET",
      path: "/chat",
      type: "open",
    });
    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }

    connection.emitFrame({
      data: Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n").toString(
        "base64",
      ),
      direction: "response",
      streamId: openFrame.streamId,
      type: "data",
    });
    await expect(rawClient.waitForData()).resolves.toEqual(
      Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n"),
    );

    rawClient.socket.write("client-bytes");
    const requestDataFrame = await connection.waitForSentFrame(
      (frame): frame is DataFrame =>
        frame.type === "data" &&
        frame.direction === "request" &&
        Buffer.from(frame.data, "base64").toString("utf8") === "client-bytes",
    );

    expect(requestDataFrame).toMatchObject({ streamId: openFrame.streamId });
  });

  it("does not route an unknown websocket host to the only tunnel", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.intranet.winetree94.com",
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "other.proxy.intranet.winetree94.com",
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          if (rawClient.socket.destroyed) {
            resolve();
            return;
          }
          rawClient.socket.once("close", () => resolve());
          rawClient.socket.destroy();
        }),
    );

    const response = await rawClient.waitForData();

    expect(response.toString("utf8")).toContain("404 Not Found");
    expect(connection.sent).toEqual([]);
  });
});
