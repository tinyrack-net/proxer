import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import type { RuntimeLogger } from "#app/lib/logging.ts";
import type { DataFrame, TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { parseTrustedProxyValues } from "#app/server/trusted-proxies.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };
const AUTHORIZATION_HEADER = "authorization";

const basic = (value: string): string => {
  return `Basic ${Buffer.from(value).toString("base64")}`;
};

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
  extraHeaders = "",
  path = "/chat",
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
    `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      extraHeaders +
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

const waitForSocketClose = async (socket: net.Socket): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
  });
};

const rejectAfter = (timeoutMs: number, message: string): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  });
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

  it("rejects missing basic auth for a protected websocket tunnel", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      basicAuth: { password: "secret" },
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(handle.url);
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const response = await rawClient.waitForData();

    expect(response.toString("utf8")).toContain("401 Unauthorized");
    expect(response.toString("utf8")).toContain(
      'www-authenticate: Basic realm="proxer"',
    );
    expect(connection.sent).toEqual([]);
  });

  it("accepts any basic auth username for password-only websocket tunnels", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      basicAuth: { password: "secret" },
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "demo.localhost",
      `Authorization: ${basic("anything:secret")}\r\n`,
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );

    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }
    expect(openFrame.headers).not.toHaveProperty("authorization");
  });

  it("rejects a wrong configured basic auth username for websocket tunnels", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      basicAuth: { password: "secret", username: "admin" },
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "demo.localhost",
      `Authorization: ${basic("other:secret")}\r\n`,
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const response = await rawClient.waitForData();

    expect(response.toString("utf8")).toContain("401 Unauthorized");
    expect(connection.sent).toEqual([]);
  });

  it("strips authorization for successful protected websocket tunnels", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      basicAuth: { password: "secret", username: "admin" },
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "demo.localhost",
      `Authorization: ${basic("admin:secret")}\r\n`,
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );

    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }
    expect(openFrame.headers).not.toHaveProperty("authorization");
  });

  it("preserves authorization for unprotected websocket tunnels", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "demo.localhost",
      "Authorization: Bearer app-token\r\n",
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );

    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }
    expect(openFrame.headers[AUTHORIZATION_HEADER]).toBe("Bearer app-token");
  });

  it("logs safe websocket open and close summaries", async () => {
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
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "demo.localhost",
      "",
      "/chat?token=secret",
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );
    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }

    connection.emitFrame({ streamId: openFrame.streamId, type: "close" });
    await waitForSocketClose(rawClient.socket);

    expect(logger.messages).toHaveLength(2);
    expect(logger.messages[0]).toContain("[demo] WS /chat opened");
    expect(logger.messages.at(-1)).toContain("[demo] WS /chat closed");
    expect(logger.messages.join("\n")).not.toContain("token=secret");
    expect(logger.messages.join("\n")).not.toContain("secret");
  });

  it("closes websocket upgrades when the tunnel does not send a handshake response", async () => {
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
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(handle.url);
    cleanups.push(() => {
      rawClient.socket.destroy();
    });
    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );
    if (openFrame.type !== "open") {
      throw new Error("expected websocket open frame");
    }

    await Promise.race([
      waitForSocketClose(rawClient.socket),
      rejectAfter(250, "expected websocket upgrade socket to close"),
    ]);
    await expect(
      Promise.race([
        connection.waitForSentFrame(
          (frame) =>
            frame.type === "close" &&
            "streamId" in frame &&
            frame.streamId === openFrame.streamId,
        ),
        rejectAfter(250, "expected websocket tunnel close frame"),
      ]),
    ).resolves.toMatchObject({ streamId: openFrame.streamId, type: "close" });
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

  it("logs safe websocket no-route and no-tunnel summaries", async () => {
    const logger = createLogger();
    const registry = new TunnelRegistry();
    const handle = await startPublicHttpServer({
      address: randomAddress,
      domain: "proxy.example.com",
      logger,
      registry,
    });
    cleanups.push(() => handle.close());

    const noRouteClient = await connectRawUpgrade(
      handle.url,
      "unmatched.example.net",
      "",
      "/chat?token=secret",
    );
    cleanups.push(() => {
      noRouteClient.socket.destroy();
    });
    const noRouteResponse = await noRouteClient.waitForData();
    const noTunnelClient = await connectRawUpgrade(
      handle.url,
      "demo.proxy.example.com",
      "",
      "/chat?token=secret",
    );
    cleanups.push(() => {
      noTunnelClient.socket.destroy();
    });
    const noTunnelResponse = await noTunnelClient.waitForData();

    expect(noRouteResponse.toString("utf8")).toContain("404 Not Found");
    expect(noTunnelResponse.toString("utf8")).toContain("404 Not Found");
    expect(logger.messages).toHaveLength(2);
    expect(logger.messages[0]).toContain("[unknown] WS /chat -> 404 no-route");
    expect(logger.messages[1]).toContain("[demo] WS /chat -> 404 no-tunnel");
    expect(logger.messages.join("\n")).not.toContain("token=secret");
    expect(logger.messages.join("\n")).not.toContain("secret");
  });

  it("does not route untrusted websocket forwarded hosts", async () => {
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
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "attacker.example.com",
      "X-Forwarded-Host: demo.proxy.example.com\r\n",
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });

    const response = await rawClient.waitForData();

    expect(response.toString("utf8")).toContain("404 Not Found");
    expect(connection.sent).toEqual([]);
  });

  it("routes trusted websocket forwarded hosts", async () => {
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
    cleanups.push(() => handle.close());

    const rawClient = await connectRawUpgrade(
      handle.url,
      "attacker.example.com",
      "X-Forwarded-For: 203.0.113.10\r\n" +
        "X-Forwarded-Host: demo.proxy.example.com\r\n" +
        "X-Forwarded-Proto: https\r\n",
    );
    cleanups.push(() => {
      rawClient.socket.destroy();
    });

    const openFrame = await connection.waitForSentFrame(
      (frame) => frame.type === "open" && frame.kind === "websocket",
    );

    expect(openFrame).toMatchObject({
      headers: {
        host: "attacker.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "demo.proxy.example.com",
        "x-forwarded-proto": "https",
      },
    });
  });
});
