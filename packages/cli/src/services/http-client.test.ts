import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocketServer } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import { startControlServer } from "#app/server/control-server.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { listenOnRandomPort } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

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
): Promise<{
  readonly body: string;
  readonly status: number;
}> => {
  return await new Promise((resolve, reject) => {
    const request = http.request(
      new URL("/", url),
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
      serverUrl: `ws://${address.host}:${address.port}`,
      subdomain: "demo",
      token: "secret",
    });
    cleanups.push(() => client.close());

    await waitFor(() => pings > 0, "expected heartbeat ping");

    expect(pings).toBeGreaterThan(0);
  });

  it("reconnects and re-registers after the control connection drops", async () => {
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
      reconnectDelayMs: 10,
      serverUrl: controlServer.url,
      subdomain: "demo",
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

    await expect(requestPublic(publicServer.url)).resolves.toEqual({
      body: "ok",
      status: 200,
    });
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
      serverUrl: controlServer.url,
      subdomain: "demo",
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
      serverUrl: controlServer.url,
      subdomain: "demo",
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
        serverUrl: "ws://127.0.0.1:1",
        subdomain: "demo",
      }),
    ).rejects.toThrow("token is required");
  });
});
