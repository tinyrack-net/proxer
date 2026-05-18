import { createHash } from "node:crypto";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import { listenOnRandomPort } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const basic = (value: string): string => {
  return `Basic ${Buffer.from(value).toString("base64")}`;
};

const createLocalJsonEchoServer = async (): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          body: Buffer.concat(chunks).toString("utf8"),
          method: request.method,
          path: request.url,
        }),
      );
    });
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createLocalDelayedJsonEchoServer = async (): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const timers = new Set<NodeJS.Timeout>();
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      const id = Number(request.url?.match(/^\/api\/(\d+)$/)?.[1] ?? 0);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              body: Buffer.concat(chunks).toString("utf8"),
              method: request.method,
              path: request.url,
            }),
          );
        },
        (id % 5) * 5,
      );
      timers.add(timer);
    });
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createLocalNamedJsonServer = async (
  name: string,
): Promise<{
  readonly port: number;
  readonly requestCount: number;
  close(): Promise<void>;
}> => {
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        name,
        path: request.url,
      }),
    );
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    get requestCount() {
      return requestCount;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createLocalBlockingJsonServer = async (
  name: string,
): Promise<{
  readonly port: number;
  readonly requestCount: number;
  readonly requestReceived: Promise<void>;
  close(): Promise<void>;
  release(): void;
}> => {
  let requestCount = 0;
  let resolveRequestReceived: () => void = () => {};
  let releaseResponse: () => void = () => {};
  const requestReceived = new Promise<void>((resolve) => {
    resolveRequestReceived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const server = http.createServer((request, response) => {
    requestCount += 1;
    resolveRequestReceived();
    void released.then(() => {
      if (response.destroyed) {
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name,
          path: request.url,
        }),
      );
    });
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    requestReceived,
    get requestCount() {
      return requestCount;
    },
    release() {
      releaseResponse();
    },
    async close() {
      releaseResponse();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createDeterministicBuffer = (size: number): Buffer => {
  const payload = Buffer.allocUnsafe(size);

  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + 17) % 256;
  }

  return payload;
};

const sha256 = (payload: Buffer): string => {
  return createHash("sha256").update(payload).digest("hex");
};

const createLocalRequestDigestServer = async (): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          bodySha256: sha256(body),
          bodySize: body.length,
          method: request.method,
          path: request.url,
        }),
      );
    });
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createLocalChunkedBinaryServer = async (
  chunks: Buffer[],
): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const timers = new Set<NodeJS.Timeout>();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });

    const writeChunk = (index: number) => {
      if (index >= chunks.length) {
        response.end();
        return;
      }

      response.write(chunks[index]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        writeChunk(index + 1);
      }, 1);
      timers.add(timer);
    };

    writeChunk(0);
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const requestPublicJson = async (
  publicUrl: string,
  options: { readonly authorization?: string; readonly host?: string } = {},
): Promise<{
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly status: number;
}> => {
  const requestUrl = new URL("/api/hello?x=1", publicUrl);

  return await new Promise((resolve, reject) => {
    const request = http.request(
      requestUrl,
      {
        headers: {
          ...(options.authorization
            ? { authorization: options.authorization }
            : {}),
          "content-type": "text/plain",
          ...(options.host ? { host: options.host } : {}),
        },
        method: "POST",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.write("hello ");
    request.end("world");
  });
};

const postPublicJson = async ({
  body,
  host,
  path,
  publicUrl,
}: {
  readonly body: string;
  readonly host: string;
  readonly path: string;
  readonly publicUrl: string;
}): Promise<{
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly status: number;
}> => {
  const requestUrl = new URL(path, publicUrl);

  return await new Promise((resolve, reject) => {
    const request = http.request(
      requestUrl,
      {
        headers: {
          "content-type": "text/plain",
          host,
        },
        method: "POST",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
};

const requestPublicBuffer = async ({
  body,
  host,
  method = "GET",
  path,
  publicUrl,
}: {
  readonly body?: Buffer;
  readonly host: string;
  readonly method?: string;
  readonly path: string;
  readonly publicUrl: string;
}): Promise<{
  readonly body: Buffer;
  readonly headers: http.IncomingHttpHeaders;
  readonly status: number;
}> => {
  const requestUrl = new URL(path, publicUrl);

  return await new Promise((resolve, reject) => {
    const request = http.request(
      requestUrl,
      {
        headers: {
          ...(body ? { "content-length": body.length } : {}),
          host,
        },
        method,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(body);
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

describe("HTTP tunnel integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("proxies a POST request through the full tunnel", async () => {
    const localServer = await createLocalJsonEchoServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const response = await requestPublicJson(proxerServer.publicUrl, {
      host: "demo.localhost",
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({
      body: "hello world",
      method: "POST",
      path: "/api/hello?x=1",
    });
  });

  it("proxies HTTP requests through an auto-assigned subdomain", async () => {
    const localServer = await createLocalJsonEchoServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    expect(tunnelClient.subdomain).toMatch(/^px-/);
    const response = await requestPublicJson(proxerServer.publicUrl, {
      host: `${tunnelClient.subdomain}.localhost`,
    });
    const rootResponse = await requestPublicJson(proxerServer.publicUrl);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      body: "hello world",
      method: "POST",
      path: "/api/hello?x=1",
    });
    expect(rootResponse.status).toBe(404);
  });

  it("requires public basic auth before forwarding HTTP requests", async () => {
    const localServer = await createLocalNamedJsonServer("protected");
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      basicAuth: { password: "site-secret" },
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const missingAuthResponse = await requestPublicJson(
      proxerServer.publicUrl,
      {
        host: "demo.localhost",
      },
    );

    expect(missingAuthResponse.status).toBe(401);
    expect(localServer.requestCount).toBe(0);

    const authorizedResponse = await requestPublicJson(proxerServer.publicUrl, {
      authorization: basic("anything:site-secret"),
      host: "demo.localhost",
    });

    expect(authorizedResponse.status).toBe(200);
    expect(JSON.parse(authorizedResponse.body)).toEqual({
      name: "protected",
      path: "/api/hello?x=1",
    });
    expect(localServer.requestCount).toBe(1);
  });

  it("requires public basic auth with an auto-assigned subdomain", async () => {
    const localServer = await createLocalNamedJsonServer("protected");
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      basicAuth: { password: "site-secret" },
      localPort: localServer.port,
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const host = `${tunnelClient.subdomain}.localhost`;

    const missingAuthResponse = await requestPublicJson(
      proxerServer.publicUrl,
      { host },
    );
    const authorizedResponse = await requestPublicJson(proxerServer.publicUrl, {
      authorization: basic("anything:site-secret"),
      host,
    });

    expect(missingAuthResponse.status).toBe(401);
    expect(authorizedResponse.status).toBe(200);
    expect(JSON.parse(authorizedResponse.body)).toEqual({
      name: "protected",
      path: "/api/hello?x=1",
    });
  });

  it("isolates concurrent HTTP streams over one tunnel", async () => {
    const localServer = await createLocalDelayedJsonEchoServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const requests = Array.from({ length: 20 }, (_, index) => {
      const requestId = `request-${index}`;

      return {
        body: `body-${requestId}`,
        path: `/api/${index}`,
        requestId,
      };
    });

    const responses = await Promise.all(
      requests.map(async (request) => ({
        request,
        response: await postPublicJson({
          body: request.body,
          host: "demo.localhost",
          path: request.path,
          publicUrl: proxerServer.publicUrl,
        }),
      })),
    );

    for (const { request, response } of responses) {
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(response.body)).toEqual({
        body: request.body,
        method: "POST",
        path: request.path,
      });
    }
  });

  it("preserves a large HTTP request body through the full tunnel", async () => {
    const localServer = await createLocalRequestDigestServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());
    const payload = createDeterministicBuffer(1024 * 1024);

    const response = await requestPublicBuffer({
      body: payload,
      host: "demo.localhost",
      method: "POST",
      path: "/upload",
      publicUrl: proxerServer.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(response.body.toString("utf8"))).toEqual({
      bodySha256: sha256(payload),
      bodySize: payload.length,
      method: "POST",
      path: "/upload",
    });
  });

  it("preserves a chunked HTTP response through the full tunnel", async () => {
    const responseChunks = Array.from({ length: 16 }, (_, index) => {
      const chunk = createDeterministicBuffer(64 * 1024);
      chunk[0] = index;

      return chunk;
    });
    const expectedBody = Buffer.concat(responseChunks);
    const localServer = await createLocalChunkedBinaryServer(responseChunks);
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const response = await requestPublicBuffer({
      host: "demo.localhost",
      path: "/download",
      publicUrl: proxerServer.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.body.length).toBe(expectedBody.length);
    expect(sha256(response.body)).toBe(sha256(expectedBody));
  });

  it("returns 404 for direct localhost requests without a matching route", async () => {
    const localServer = await createLocalJsonEchoServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const response = await requestPublicJson(proxerServer.publicUrl);

    expect(response.status).toBe(404);
  });

  it("routes root and subdomain clients exactly when a server domain is configured", async () => {
    const rootLocalServer = await createLocalJsonEchoServer();
    const demoLocalServer = await createLocalJsonEchoServer();
    cleanups.push(() => rootLocalServer.close());
    cleanups.push(() => demoLocalServer.close());
    const proxerServer = await startServer({
      domain: "proxy.intranet.winetree94.com",
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const rootTunnelClient = await startHttpTunnelClient({
      localPort: rootLocalServer.port,
      route: { type: "root" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => rootTunnelClient.close());
    const demoTunnelClient = await startHttpTunnelClient({
      localPort: demoLocalServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => demoTunnelClient.close());

    const rootResponse = await requestPublicJson(proxerServer.publicUrl, {
      host: "proxy.intranet.winetree94.com",
    });
    const demoResponse = await requestPublicJson(proxerServer.publicUrl, {
      host: "demo.proxy.intranet.winetree94.com",
    });
    const unknownResponse = await requestPublicJson(proxerServer.publicUrl, {
      host: "other.proxy.intranet.winetree94.com",
    });

    expect(rootResponse.status).toBe(200);
    expect(demoResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(404);
  });

  it("isolates multiple subdomain clients under one server", async () => {
    const routes = ["alpha", "beta", "gamma"] as const;
    const localServers = await Promise.all(
      routes.map(async (route) => ({
        route,
        server: await createLocalNamedJsonServer(route),
      })),
    );
    for (const { server } of localServers) {
      cleanups.push(() => server.close());
    }
    const proxerServer = await startServer({
      domain: "proxy.example.test",
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClients = await Promise.all(
      localServers.map(async ({ route, server }) =>
        startHttpTunnelClient({
          localPort: server.port,
          route: { type: "subdomain", subdomain: route },
          serverUrl: proxerServer.controlUrl,
          token: "dev-token",
        }),
      ),
    );
    for (const tunnelClient of tunnelClients) {
      cleanups.push(() => tunnelClient.close());
    }

    const responses = await Promise.all(
      routes.map(async (route) => ({
        response: await requestPublicJson(proxerServer.publicUrl, {
          host: `${route}.proxy.example.test`,
        }),
        route,
      })),
    );
    const unknownResponse = await requestPublicJson(proxerServer.publicUrl, {
      host: "unknown.proxy.example.test",
    });

    for (const { response, route } of responses) {
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        name: route,
        path: "/api/hello?x=1",
      });
      for (const otherRoute of routes.filter(
        (candidate) => candidate !== route,
      )) {
        expect(response.body).not.toContain(otherRoute);
      }
    }
    expect(unknownResponse.status).toBe(404);
  });

  it("does not route direct requests to the only registered tunnel", async () => {
    const localServer = await createLocalJsonEchoServer();
    cleanups.push(() => localServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const response = await requestPublicJson(proxerServer.publicUrl);

    expect(response.status).toBe(404);
  });

  it("fails an in-flight HTTP request on tunnel disconnect and does not replay it after re-registration", async () => {
    const oldLocalServer = await createLocalBlockingJsonServer("old");
    cleanups.push(() => oldLocalServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const oldTunnelClient = await startHttpTunnelClient({
      localPort: oldLocalServer.port,
      reconnectDelayMs: 60_000,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => oldTunnelClient.close());
    const inFlightResponse = requestPublicJson(proxerServer.publicUrl, {
      host: "demo.localhost",
    });
    await oldLocalServer.requestReceived;

    await oldTunnelClient.close();
    const interruptedResponse = await withTimeout(
      inFlightResponse,
      1_000,
      "in-flight HTTP request did not fail promptly after tunnel disconnect",
    );

    expect(interruptedResponse.status).toBe(502);
    expect(oldLocalServer.requestCount).toBe(1);

    const newLocalServer = await createLocalNamedJsonServer("new");
    cleanups.push(() => newLocalServer.close());
    const newTunnelClient = await startHttpTunnelClient({
      localPort: newLocalServer.port,
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => newTunnelClient.close());

    const newResponse = await requestPublicJson(proxerServer.publicUrl, {
      host: "demo.localhost",
    });

    expect(newResponse.status).toBe(200);
    expect(JSON.parse(newResponse.body)).toEqual({
      name: "new",
      path: "/api/hello?x=1",
    });
    expect(newLocalServer.requestCount).toBe(1);
    expect(oldLocalServer.requestCount).toBe(1);
  });
});
