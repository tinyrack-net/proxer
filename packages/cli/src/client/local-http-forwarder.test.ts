import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { attachLocalHttpForwarder } from "#app/client/local-http-forwarder.ts";
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

const listenOnRandomPort = async (server: http.Server): Promise<number> => {
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

const closeServer = async (server: http.Server): Promise<void> => {
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

describe("local HTTP forwarder", () => {
  const cleanups: Array<() => void> = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("forwards tunnel request frames to a local HTTP service", async () => {
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString("utf8"),
            method: request.method,
            url: request.url,
          }),
        );
      });
    });
    servers.push(server);
    const port = await listenOnRandomPort(server);
    const connection = new FakeTunnelConnection();
    cleanups.push(attachLocalHttpForwarder({ connection, localPort: port }));

    connection.emitFrame({
      headers: { "content-type": "text/plain" },
      kind: "http",
      method: "POST",
      path: "/api/hello?x=1",
      streamId: "stream-1",
      type: "open",
    });
    connection.emitFrame({
      data: Buffer.from("hello ").toString("base64"),
      direction: "request",
      streamId: "stream-1",
      type: "data",
    });
    connection.emitFrame({
      data: Buffer.from("world").toString("base64"),
      direction: "request",
      streamId: "stream-1",
      type: "data",
    });
    connection.emitFrame({
      direction: "request",
      streamId: "stream-1",
      type: "end",
    });

    await connection.waitForSentFrame(
      (frame) => frame.type === "end" && frame.direction === "response",
    );
    const responseBody = Buffer.concat(
      connection.sent
        .filter(
          (frame): frame is DataFrame =>
            frame.type === "data" && frame.direction === "response",
        )
        .map((frame) => Buffer.from(frame.data, "base64")),
    ).toString("utf8");

    expect(
      connection.sent.find((frame) => frame.type === "headers"),
    ).toMatchObject({
      headers: { "content-type": "application/json" },
      status: 200,
      streamId: "stream-1",
      type: "headers",
    });
    expect(JSON.parse(responseBody)).toEqual({
      body: "hello world",
      method: "POST",
      url: "/api/hello?x=1",
    });
  });

  it("streams local response chunks as response data frames", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("one");
      setTimeout(() => {
        response.end("two");
      }, 20);
    });
    servers.push(server);
    const port = await listenOnRandomPort(server);
    const connection = new FakeTunnelConnection();
    cleanups.push(attachLocalHttpForwarder({ connection, localPort: port }));

    connection.emitFrame({
      headers: {},
      kind: "http",
      method: "GET",
      path: "/stream",
      streamId: "stream-2",
      type: "open",
    });
    connection.emitFrame({
      direction: "request",
      streamId: "stream-2",
      type: "end",
    });

    const firstDataFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "data" && frame.direction === "response",
    );
    expect(firstDataFrame).toMatchObject({
      data: Buffer.from("one").toString("base64"),
      streamId: "stream-2",
    });
    expect(
      connection.sent.some(
        (frame) => frame.type === "end" && frame.direction === "response",
      ),
    ).toBe(false);

    await connection.waitForSentFrame(
      (frame) => frame.type === "end" && frame.direction === "response",
    );
    const responseBody = Buffer.concat(
      connection.sent
        .filter(
          (frame): frame is DataFrame =>
            frame.type === "data" && frame.direction === "response",
        )
        .map((frame) => Buffer.from(frame.data, "base64")),
    ).toString("utf8");
    expect(responseBody).toBe("onetwo");
  });

  it("sends an error frame when the local service connection fails", async () => {
    const server = http.createServer();
    const port = await listenOnRandomPort(server);
    await closeServer(server);
    const connection = new FakeTunnelConnection();
    cleanups.push(attachLocalHttpForwarder({ connection, localPort: port }));

    connection.emitFrame({
      headers: {},
      kind: "http",
      method: "GET",
      path: "/missing",
      streamId: "stream-3",
      type: "open",
    });

    const errorFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "error",
    );
    expect(errorFrame).toMatchObject({
      message: expect.stringContaining("ECONNREFUSED") as string,
      streamId: "stream-3",
      type: "error",
    });
  });
});
