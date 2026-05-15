import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import { listenOnRandomPort } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

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

const requestPublicJson = async (
  publicUrl: string,
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
          "content-type": "text/plain",
          host: "demo.localhost",
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
      controlAddress: randomAddress,
      publicAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localServer.port,
      name: "demo",
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const response = await requestPublicJson(proxerServer.publicUrl);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({
      body: "hello world",
      method: "POST",
      path: "/api/hello?x=1",
    });
  });
});
