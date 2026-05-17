import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import type { RuntimeLogger } from "#app/lib/logging.ts";
import type { DataFrame, TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { parseTrustedProxyValues } from "#app/server/trusted-proxies.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const createLogger = (): RuntimeLogger & { readonly messages: string[] } => {
  const messages: string[] = [];
  return {
    error(message) {
      messages.push(message);
    },
    info(message) {
      messages.push(message);
    },
    messages,
  };
};

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
    expect(response.body).toContain(
      "No tunnel registered for subdomain missing",
    );
  });

  it("routes root and subdomain hosts explicitly for a configured domain", async () => {
    const registry = new TunnelRegistry();
    const rootConnection = new FakeTunnelConnection();
    const demoConnection = new FakeTunnelConnection();
    registry.register({ route: { type: "root" }, connection: rootConnection });
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection: demoConnection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.intranet.winetree94.com",
      registry,
    });
    handles.push(handle);

    const rootResponsePromise = requestPublic({
      headers: { host: "proxy.intranet.winetree94.com" },
      url: handle.url,
    });
    const rootOpenFrame = await rootConnection.waitForSentFrame(
      (frame) => frame.type === "open",
    );
    if (rootOpenFrame.type !== "open") {
      throw new Error("expected root open frame");
    }
    rootConnection.emitFrame({
      headers: { "content-type": "text/plain" },
      status: 200,
      streamId: rootOpenFrame.streamId,
      type: "headers",
    });
    rootConnection.emitFrame({
      data: Buffer.from("root").toString("base64"),
      direction: "response",
      streamId: rootOpenFrame.streamId,
      type: "data",
    });
    rootConnection.emitFrame({
      direction: "response",
      streamId: rootOpenFrame.streamId,
      type: "end",
    });

    await expect(rootResponsePromise).resolves.toMatchObject({
      body: "root",
      status: 200,
    });

    const demoResponsePromise = requestPublic({
      headers: { host: "demo.proxy.intranet.winetree94.com" },
      url: handle.url,
    });
    const demoOpenFrame = await demoConnection.waitForSentFrame(
      (frame) => frame.type === "open",
    );
    if (demoOpenFrame.type !== "open") {
      throw new Error("expected demo open frame");
    }
    demoConnection.emitFrame({
      headers: { "content-type": "text/plain" },
      status: 200,
      streamId: demoOpenFrame.streamId,
      type: "headers",
    });
    demoConnection.emitFrame({
      data: Buffer.from("demo").toString("base64"),
      direction: "response",
      streamId: demoOpenFrame.streamId,
      type: "data",
    });
    demoConnection.emitFrame({
      direction: "response",
      streamId: demoOpenFrame.streamId,
      type: "end",
    });

    await expect(demoResponsePromise).resolves.toMatchObject({
      body: "demo",
      status: 200,
    });

    const unknownResponse = await requestPublic({
      headers: { host: "other.proxy.intranet.winetree94.com" },
      url: handle.url,
    });

    expect(unknownResponse.status).toBe(404);
    expect(rootConnection.sent).toHaveLength(2);
    expect(demoConnection.sent).toHaveLength(2);
  });

  it("does not route unmatched direct requests to the only tunnel", async () => {
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
    handles.push(handle);

    const response = await requestPublic({ url: handle.url });

    expect(response.status).toBe(404);
    expect(connection.sent).toEqual([]);
  });

  it("does not route untrusted forwarded hosts", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.example.com",
      registry,
    });
    handles.push(handle);

    const response = await requestPublic({
      headers: {
        host: "attacker.example.com",
        "x-forwarded-host": "demo.proxy.example.com",
      },
      url: handle.url,
    });

    expect(response.status).toBe(404);
    expect(connection.sent).toEqual([]);
  });

  it("routes trusted forwarded hosts and forwards canonical headers", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.example.com",
      registry,
      trustedProxies: parseTrustedProxyValues(["loopback"]),
    });
    handles.push(handle);

    const responsePromise = requestPublic({
      headers: {
        host: "attacker.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "demo.proxy.example.com",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.11",
      },
      url: handle.url,
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open",
    );

    expect(openFrame).toMatchObject({
      headers: {
        host: "attacker.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "demo.proxy.example.com",
        "x-forwarded-proto": "https",
      },
    });
    if (openFrame.type !== "open") {
      throw new Error("expected open frame");
    }
    connection.emitFrame({
      headers: {},
      status: 200,
      streamId: openFrame.streamId,
      type: "headers",
    });
    connection.emitFrame({
      direction: "response",
      streamId: openFrame.streamId,
      type: "end",
    });

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it("opens a tunnel stream for a registered host", async () => {
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

  it("logs a safe proxied HTTP access summary", async () => {
    const logger = createLogger();
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      logger,
      registry,
    });
    handles.push(handle);

    const responsePromise = requestPublic({
      headers: { host: "demo.localhost" },
      path: "/hello?token=secret",
      url: handle.url,
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open",
    );
    if (openFrame.type !== "open") {
      throw new Error("expected open frame");
    }
    connection.emitFrame({
      headers: {},
      status: 200,
      streamId: openFrame.streamId,
      type: "headers",
    });
    connection.emitFrame({
      direction: "response",
      streamId: openFrame.streamId,
      type: "end",
    });

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0]).toContain("[demo] GET /hello -> 200");
    expect(logger.messages[0]).not.toContain("token=secret");
    expect(logger.messages[0]).not.toContain("secret");
  });

  it("logs safe HTTP no-route and no-tunnel summaries", async () => {
    const logger = createLogger();
    const registry = new TunnelRegistry();
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.example.com",
      logger,
      registry,
    });
    handles.push(handle);

    const noRouteResponse = await requestPublic({
      headers: { host: "unmatched.example.net" },
      path: "/hello?token=secret",
      url: handle.url,
    });
    const noTunnelResponse = await requestPublic({
      headers: { host: "demo.proxy.example.com" },
      path: "/hello?token=secret",
      url: handle.url,
    });

    expect(noRouteResponse.status).toBe(404);
    expect(noTunnelResponse.status).toBe(404);
    expect(logger.messages).toHaveLength(2);
    expect(logger.messages[0]).toContain(
      "[unknown] GET /hello -> 404 no-route",
    );
    expect(logger.messages[1]).toContain("[demo] GET /hello -> 404 no-tunnel");
    expect(logger.messages.join("\n")).not.toContain("token=secret");
    expect(logger.messages.join("\n")).not.toContain("secret");
  });

  it("forwards request body data and request end frames", async () => {
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

  it("times out streams that do not receive response headers", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      route: { type: "subdomain", subdomain: "demo" },
      connection,
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
      streamTimeoutMs: 10,
    });
    handles.push(handle);

    const responsePromise = requestPublic({
      headers: { host: "demo.localhost" },
      url: handle.url,
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open",
    );

    await expect(responsePromise).resolves.toMatchObject({
      body: "Tunnel response timed out\n",
      status: 502,
    });
    expect(connection.sent).toContainEqual({
      streamId: openFrame.type === "open" ? openFrame.streamId : "",
      type: "close",
    });
  });

  it("sends a close frame when the public request aborts", async () => {
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
    handles.push(handle);
    const requestUrl = new URL("/slow", handle.url);
    const request = http.request(requestUrl, {
      headers: { host: "demo.localhost" },
      method: "POST",
    });
    request.on("error", () => {});
    request.write("partial body");

    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open",
    );
    request.destroy();
    const closeFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "close",
    );

    expect(closeFrame).toEqual({
      streamId: openFrame.type === "open" ? openFrame.streamId : "",
      type: "close",
    });
  });

  it("closes an active stream when the tunnel disconnects", async () => {
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
    handles.push(handle);

    const responsePromise = requestPublic({
      headers: { host: "demo.localhost" },
      url: handle.url,
    });
    await connection.waitForSentFrame((frame) => frame.type === "open");
    await connection.close();

    await expect(responsePromise).resolves.toMatchObject({
      body: "Tunnel connection closed\n",
      status: 502,
    });
  });
});
