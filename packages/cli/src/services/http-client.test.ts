import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import type { RuntimeLogger } from "#app/lib/logging.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import { startControlServer } from "#app/server/control-server.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { listenOnRandomPort } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const createLogger = (): RuntimeLogger & { readonly messages: string[] } => {
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

const createLocalTextServer = async (): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      await closeServer(server);
    },
  };
};

const createCountingLocalTextServer = async (): Promise<{
  readonly port: number;
  getRequestCount(): number;
  close(): Promise<void>;
}> => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    getRequestCount() {
      return requestCount;
    },
    async close() {
      await closeServer(server);
    },
  };
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const waitFor = async (
  predicate: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(message);
};

const requestPublic = async (
  url: string,
  path = "/",
): Promise<{
  readonly body: string;
  readonly status: number;
}> => {
  return await new Promise((resolve, reject) => {
    const request = http.request(
      new URL(path, url),
      { headers: { host: "demo.localhost" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
};

const connectRawUpgrade = async (
  url: string,
  path = "/socket",
): Promise<net.Socket> => {
  const publicUrl = new URL(url);
  const socket = net.connect(Number(publicUrl.port), publicUrl.hostname);

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(
    `GET ${path} HTTP/1.1\r\n` +
      "Host: demo.localhost\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  return socket;
};

const rawDataToBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  throw new Error("Unsupported WebSocket payload");
};

const registerClientOnMessage = (data: RawData): string | undefined => {
  const frame = decodeFrame(rawDataToBuffer(data));
  if (frame.type !== "register") {
    return undefined;
  }

  return encodeFrame({
    type: "registered",
    ...(frame.subdomain ? { subdomain: frame.subdomain } : {}),
  });
};

describe("HTTP tunnel client reliability", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("resolves with an auto-assigned subdomain from registration", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    let registerFrame: TunnelFrame | undefined;
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        registerFrame = decodeFrame(rawDataToBuffer(data));
        socket.send(encodeFrame({ type: "registered", subdomain: "px-auto" }));
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });

    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: 1,
      reconnectDelayMs: 10,
      route: { type: "auto" },
      serverUrl: `ws://${address.host}:${address.port}`,
      token: "secret",
    });
    cleanups.push(() => client.close());

    expect(client.subdomain).toBe("px-auto");
    expect(registerFrame).toEqual({ type: "register", token: "secret" });
  });

  it("reuses an auto-assigned subdomain when reconnecting", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    const registerFrames: TunnelFrame[] = [];
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = decodeFrame(rawDataToBuffer(data));
        registerFrames.push(frame);
        socket.send(encodeFrame({ type: "registered", subdomain: "px-auto" }));
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: 1,
      reconnectDelayMs: 10,
      route: { type: "auto" },
      serverUrl: `ws://${address.host}:${address.port}`,
      token: "secret",
    });
    cleanups.push(() => client.close());
    const [firstClient] = webSocketServer.clients;
    firstClient?.close(1011, "drop");

    await waitFor(
      () => registerFrames.length >= 2,
      "expected reconnect registration",
    );

    expect(registerFrames[0]).toEqual({ type: "register", token: "secret" });
    expect(registerFrames[1]).toEqual({
      subdomain: "px-auto",
      token: "secret",
      type: "register",
    });
  });

  it("sends root registration frames for root route requests", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    let registerFrame: TunnelFrame | undefined;
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        registerFrame = decodeFrame(rawDataToBuffer(data));
        socket.send(encodeFrame({ type: "registered" }));
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });

    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: 1,
      reconnectDelayMs: 10,
      route: { type: "root" },
      serverUrl: `ws://${address.host}:${address.port}`,
      token: "secret",
    });
    cleanups.push(() => client.close());

    expect(client.subdomain).toBeUndefined();
    expect(registerFrame).toEqual({
      root: true,
      type: "register",
      token: "secret",
    });
  });

  it("rejects a mismatched explicit subdomain registration", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send(encodeFrame({ type: "registered", subdomain: "other" }));
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });

    await expect(
      startHttpTunnelClient({
        heartbeatIntervalMs: 0,
        localPort: 1,
        reconnectDelayMs: 10,
        route: { type: "subdomain", subdomain: "demo" },
        serverUrl: `ws://${address.host}:${address.port}`,
        token: "secret",
      }),
    ).rejects.toThrow('Registered unexpected tunnel "other"');
  });

  it("sends heartbeat pings after registration", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    let pings = 0;
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const registeredFrame = registerClientOnMessage(data);
        if (registeredFrame) {
          socket.send(registeredFrame);
        }
      });
      socket.on("ping", () => {
        pings += 1;
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 10,
      localPort: 1,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: `ws://${address.host}:${address.port}`,
      token: "secret",
    });
    cleanups.push(() => client.close());

    await waitFor(() => pings > 0, "expected heartbeat ping");

    expect(pings).toBeGreaterThan(0);
  });

  it("sends basic auth requirements in the registration frame", async () => {
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    let registerFrame: TunnelFrame | undefined;
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = decodeFrame(rawDataToBuffer(data));
        if (frame.type !== "register") {
          return;
        }

        registerFrame = frame;
        socket.send(
          encodeFrame({
            type: "registered",
            ...(frame.subdomain ? { subdomain: frame.subdomain } : {}),
          }),
        );
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });
    const client = await startHttpTunnelClient({
      basicAuth: { password: "site-secret", username: "admin" },
      heartbeatIntervalMs: 0,
      localPort: 1,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: `ws://${address.host}:${address.port}`,
      token: "dev-token",
    });
    cleanups.push(() => client.close());

    expect(registerFrame).toEqual({
      basicAuth: { password: "site-secret", username: "admin" },
      subdomain: "demo",
      token: "dev-token",
      type: "register",
    });
  });

  it("logs connection lifecycle without leaking the token", async () => {
    const logger = createLogger();
    const server = http.createServer();
    const webSocketServer = new WebSocketServer({ server });
    webSocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const registeredFrame = registerClientOnMessage(data);
        if (registeredFrame) {
          socket.send(registeredFrame);
        }
      });
    });
    const address = await listenOnRandomPort(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await closeServer(server);
    });

    const serverUrl = `ws://${address.host}:${address.port}/__proxer__/control?token=secret-token&state=ok`;
    const safeServerUrl = `ws://${address.host}:${address.port}/__proxer__/control`;
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: 1,
      logger,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl,
      token: "secret-token",
    });
    cleanups.push(() => client.close());

    expect(logger.messages).toContain(
      `connecting server=${safeServerUrl} route=demo`,
    );
    expect(logger.messages).toContain(`connected server=${safeServerUrl}`);
    expect(logger.messages).toContain("registered route=demo");
    expect(
      logger.messages.some((message) => message.includes("secret-token")),
    ).toBe(false);
  });

  it("passes logger and route information to local forwarders", async () => {
    const logger = createLogger();
    const localServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    localServer.on("upgrade", (_request, socket) => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n", () => {
        socket.end();
      });
    });
    const localAddress = await listenOnRandomPort(localServer);
    cleanups.push(async () => {
      await closeServer(localServer);
    });
    const registry = new TunnelRegistry();
    const publicServer = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => publicServer.close());
    const controlServer = await startControlServer({
      address: randomAddress,
      registry,
      token: "secret-token",
    });
    cleanups.push(() => controlServer.close());
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: localAddress.port,
      logger,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: controlServer.url,
      token: "secret-token",
    });
    cleanups.push(() => client.close());

    await expect(
      requestPublic(publicServer.url, "/api?token=secret"),
    ).resolves.toEqual({
      body: "ok",
      status: 200,
    });
    const socket = await connectRawUpgrade(
      publicServer.url,
      "/socket?token=secret",
    );
    cleanups.push(async () => {
      socket.destroy();
    });
    await waitFor(
      () => logger.messages.includes("[demo] WS /socket closed"),
      "expected local websocket close log",
    );

    expect(logger.messages).toContain(
      `[demo] GET /api -> local 127.0.0.1:${localAddress.port}`,
    );
    expect(logger.messages).toContain("[demo] GET /api <- 200");
    expect(logger.messages).toContain(
      `[demo] WS /socket -> local 127.0.0.1:${localAddress.port} opened`,
    );
    expect(logger.messages).toContain("[demo] WS /socket closed");
    expect(logger.messages.join("\n")).not.toContain("token=secret");
    expect(logger.messages.join("\n")).not.toContain("secret-token");
  });

  it("reconnects and re-registers after the control connection drops", async () => {
    const logger = createLogger();
    const localServer = await createLocalTextServer();
    cleanups.push(() => localServer.close());
    const registry = new TunnelRegistry();
    const publicServer = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => publicServer.close());
    const controlServer = await startControlServer({
      address: randomAddress,
      registry,
      token: "secret",
    });
    cleanups.push(() => controlServer.close());
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: localServer.port,
      logger,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: controlServer.url,
      token: "secret",
    });
    cleanups.push(() => client.close());
    const firstConnection = registry.get({
      type: "subdomain",
      subdomain: "demo",
    })?.connection;
    if (!firstConnection) {
      throw new Error("expected initial registration");
    }

    await firstConnection.close(1011, "drop");
    await waitFor(
      () => logger.messages.includes("reconnecting in 10ms"),
      "expected reconnect log",
    );
    await waitFor(() => {
      const nextConnection = registry.get({
        type: "subdomain",
        subdomain: "demo",
      })?.connection;
      return nextConnection !== undefined && nextConnection !== firstConnection;
    }, "expected tunnel client to reconnect");

    await expect(requestPublic(publicServer.url)).resolves.toEqual({
      body: "ok",
      status: 200,
    });
    expect(logger.messages).toContain("disconnected route=demo");
    expect(logger.messages).toContain("reconnecting in 10ms");
    expect(logger.messages.some((message) => message.includes("secret"))).toBe(
      false,
    );
  });

  it("does not duplicate forwarding after reconnect", async () => {
    const localServer = await createCountingLocalTextServer();
    cleanups.push(() => localServer.close());
    const registry = new TunnelRegistry();
    const publicServer = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => publicServer.close());
    const controlServer = await startControlServer({
      address: randomAddress,
      registry,
      token: "secret",
    });
    cleanups.push(() => controlServer.close());
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: localServer.port,
      reconnectDelayMs: 10,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: controlServer.url,
      token: "secret",
    });
    cleanups.push(() => client.close());
    const firstConnection = registry.get({
      type: "subdomain",
      subdomain: "demo",
    })?.connection;
    if (!firstConnection) {
      throw new Error("expected initial registration");
    }

    await firstConnection.close(1011, "drop");
    await waitFor(() => {
      const nextConnection = registry.get({
        type: "subdomain",
        subdomain: "demo",
      })?.connection;
      return nextConnection !== undefined && nextConnection !== firstConnection;
    }, "expected tunnel client to reconnect");
    const secondConnection = registry.get({
      type: "subdomain",
      subdomain: "demo",
    })?.connection;
    if (!secondConnection) {
      throw new Error("expected second registration");
    }

    await secondConnection.close(1011, "drop again");
    await waitFor(() => {
      const nextConnection = registry.get({
        type: "subdomain",
        subdomain: "demo",
      })?.connection;
      return (
        nextConnection !== undefined && nextConnection !== secondConnection
      );
    }, "expected tunnel client to reconnect again");

    await expect(requestPublic(publicServer.url)).resolves.toEqual({
      body: "ok",
      status: 200,
    });
    expect(localServer.getRequestCount()).toBe(1);
  });

  it("does not reconnect after close is called during a reconnect delay", async () => {
    const localServer = await createCountingLocalTextServer();
    cleanups.push(() => localServer.close());
    const registry = new TunnelRegistry();
    const publicServer = await startPublicHttpServer({
      address: randomAddress,
      registry,
    });
    cleanups.push(() => publicServer.close());
    const controlServer = await startControlServer({
      address: randomAddress,
      registry,
      token: "secret",
    });
    cleanups.push(() => controlServer.close());
    const client = await startHttpTunnelClient({
      heartbeatIntervalMs: 0,
      localPort: localServer.port,
      reconnectDelayMs: 100,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: controlServer.url,
      token: "secret",
    });
    cleanups.push(() => client.close());
    const firstConnection = registry.get({
      type: "subdomain",
      subdomain: "demo",
    })?.connection;
    if (!firstConnection) {
      throw new Error("expected initial registration");
    }

    await firstConnection.close(1011, "drop");
    await waitFor(
      () =>
        registry.get({ type: "subdomain", subdomain: "demo" }) === undefined,
      "expected tunnel to unregister before close",
    );
    await client.close();
    await sleep(150);

    expect(
      registry.get({ type: "subdomain", subdomain: "demo" }),
    ).toBeUndefined();
    await expect(requestPublic(publicServer.url)).resolves.toEqual({
      body: "No tunnel registered for subdomain demo\n",
      status: 404,
    });
    expect(localServer.getRequestCount()).toBe(0);
  });

  it("fails fast without a token", async () => {
    await expect(
      startHttpTunnelClient({
        heartbeatIntervalMs: 0,
        localPort: 1,
        reconnectDelayMs: 10,
        route: { type: "subdomain", subdomain: "demo" },
        serverUrl: "ws://127.0.0.1:1",
      }),
    ).rejects.toThrow("token is required");
  });
});
