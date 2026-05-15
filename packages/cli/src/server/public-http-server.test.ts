import http from "node:http";
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
  readonly #closeListeners = new Set<(error?: Error) => void>();
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

  async close(): Promise<void> {
    for (const listener of this.#closeListeners) {
      listener();
    }
  }

  onFrame(listener: (frame: TunnelFrame) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
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

const requestPublic = async ({
  body,
  headers,
  method = "GET",
  path = "/",
  url,
}: {
  readonly body?: string;
  readonly headers?: http.OutgoingHttpHeaders;
  readonly method?: string;
  readonly path?: string;
  readonly url: string;
}): Promise<{
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}> => {
  const publicUrl = new URL(path, url);

  return await new Promise((resolve, reject) => {
    const request = http.request(publicUrl, { headers, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          status: response.statusCode ?? 0,
        });
      });
    });
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
};

describe("public HTTP server", () => {
  const handles: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it("returns 404 for unknown hosts", async () => {
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestPublic({
      headers: { host: "missing.localhost" },
      url: handle.url,
    });

    expect(response.status).toBe(404);
    expect(response.body).toContain("No tunnel registered for missing");
  });

  it("opens a tunnel stream for a registered host", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({ name: "demo", connection });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);

    const responsePromise = requestPublic({
      headers: { connection: "keep-alive", host: "demo.localhost" },
      path: "/hello?x=1",
      url: handle.url,
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open",
    );

    expect(openFrame).toMatchObject({
      headers: { host: "demo.localhost" },
      kind: "http",
      method: "GET",
      path: "/hello?x=1",
      type: "open",
    });
    if (openFrame.type !== "open") {
      throw new Error("expected open frame");
    }
    connection.emitFrame({
      headers: { "content-type": "text/plain" },
      status: 201,
      streamId: openFrame.streamId,
      type: "headers",
    });
    connection.emitFrame({
      data: Buffer.from("created").toString("base64"),
      direction: "response",
      streamId: openFrame.streamId,
      type: "data",
    });
    connection.emitFrame({
      direction: "response",
      streamId: openFrame.streamId,
      type: "end",
    });

    await expect(responsePromise).resolves.toMatchObject({
      body: "created",
      status: 201,
    });
  });

  it("forwards request body data and request end frames", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({ name: "demo", connection });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);

    const responsePromise = requestPublic({
      body: "one-two",
      headers: { host: "demo.localhost" },
      method: "POST",
      path: "/upload",
      url: handle.url,
    });
    const requestEndFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "end" && frame.direction === "request",
    );
    const body = Buffer.concat(
      connection.sent
        .filter(
          (frame): frame is DataFrame =>
            frame.type === "data" && frame.direction === "request",
        )
        .map((frame) => Buffer.from(frame.data, "base64")),
    ).toString("utf8");

    expect(body).toBe("one-two");
    if (requestEndFrame.type !== "end") {
      throw new Error("expected request end frame");
    }
    connection.emitFrame({
      headers: {},
      status: 204,
      streamId: requestEndFrame.streamId,
      type: "headers",
    });
    connection.emitFrame({
      direction: "response",
      streamId: requestEndFrame.streamId,
      type: "end",
    });

    await expect(responsePromise).resolves.toMatchObject({ status: 204 });
  });
});
