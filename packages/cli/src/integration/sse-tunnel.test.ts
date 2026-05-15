import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import { createLocalSseServer } from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const requestSse = (
  url: string,
): {
  readonly firstChunk: Promise<string>;
  readonly fullResponse: Promise<{
    readonly body: string;
    readonly headers: http.IncomingHttpHeaders;
    readonly status: number;
  }>;
} => {
  let resolveFirstChunk: (chunk: string) => void = () => {};
  let rejectFirstChunk: (error: Error) => void = () => {};
  const firstChunk = new Promise<string>((resolve, reject) => {
    resolveFirstChunk = resolve;
    rejectFirstChunk = reject;
  });
  const requestUrl = new URL("/events", url);
  const fullResponse = new Promise<{
    body: string;
    headers: http.IncomingHttpHeaders;
    status: number;
  }>((resolve, reject) => {
    const request = http.request(
      requestUrl,
      { headers: { host: "demo.localhost" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.once("data", (chunk: Buffer) => {
          resolveFirstChunk(Buffer.from(chunk).toString("utf8"));
        });
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
    request.on("error", (error) => {
      rejectFirstChunk(error);
      reject(error);
    });
    request.end();
  });

  return { firstChunk, fullResponse };
};

describe("SSE tunnel integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("streams SSE chunks through the full tunnel without buffering", async () => {
    let localResponseEnded = false;
    let secondEventWritten = false;
    const localSseServer = await createLocalSseServer({
      onResponseEnded() {
        localResponseEnded = true;
      },
      onSecondEventWritten() {
        secondEventWritten = true;
      },
    });
    cleanups.push(() => localSseServer.close());
    const proxerServer = await startServer({
      controlAddress: randomAddress,
      publicAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localSseServer.port,
      name: "demo",
      serverUrl: proxerServer.controlUrl,
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const { firstChunk, fullResponse } = requestSse(proxerServer.publicUrl);
    const observedFirstChunk = await firstChunk;

    expect(observedFirstChunk).toBe("data: one\n\n");
    expect(localResponseEnded).toBe(false);
    expect(secondEventWritten).toBe(false);

    const response = await fullResponse;

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.body).toBe("data: one\n\ndata: two\n\n");
  });
});
