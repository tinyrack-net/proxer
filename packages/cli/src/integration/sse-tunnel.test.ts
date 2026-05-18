import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import { startHttpTunnelClient } from "#app/services/http-client.ts";
import { startServer } from "#app/services/server.ts";
import {
  createLocalSseServer,
  listenOnRandomPort,
} from "#app/test/local-servers.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const requestSse = (
  url: string,
  pathname = "/events",
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
  const requestUrl = new URL(pathname, url);
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
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localSseServer.port,
      serverUrl: proxerServer.controlUrl,
      subdomain: "demo",
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

  it("streams concurrent SSE clients independently", async () => {
    const timers = new Set<NodeJS.Timeout>();
    const localServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const streamId = requestUrl.searchParams.get("stream");
      if (requestUrl.pathname !== "/events" || streamId === null) {
        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Not found\n");
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
      });
      response.write(`data: ${streamId}:one\n\n`);

      const delayMs = (Number(streamId.replace("stream-", "")) % 3) * 10;
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.write(`data: ${streamId}:two\n\n`);
        response.end();
      }, delayMs);
      timers.add(timer);
    });
    const localAddress = await listenOnRandomPort(localServer);
    cleanups.push(async () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      await new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const tunnelClient = await startHttpTunnelClient({
      localPort: localAddress.port,
      serverUrl: proxerServer.controlUrl,
      subdomain: "demo",
      token: "dev-token",
    });
    cleanups.push(() => tunnelClient.close());

    const requests = ["stream-0", "stream-1", "stream-2"].map((streamId) => ({
      streamId,
      ...requestSse(proxerServer.publicUrl, `/events?stream=${streamId}`),
    }));
    const firstChunks = await Promise.all(
      requests.map(async ({ firstChunk, streamId }) => ({
        streamId,
        chunk: await firstChunk,
      })),
    );

    expect(firstChunks).toEqual([
      { streamId: "stream-0", chunk: "data: stream-0:one\n\n" },
      { streamId: "stream-1", chunk: "data: stream-1:one\n\n" },
      { streamId: "stream-2", chunk: "data: stream-2:one\n\n" },
    ]);

    const responses = await Promise.all(
      requests.map(async ({ fullResponse, streamId }) => ({
        streamId,
        response: await fullResponse,
      })),
    );

    for (const { response, streamId } of responses) {
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");
      expect(response.body).toBe(
        `data: ${streamId}:one\n\ndata: ${streamId}:two\n\n`,
      );
    }
  });

  it("ends an in-flight SSE stream on tunnel disconnect and does not replay it after re-registration", async () => {
    const oldLocalSseServer = await createLocalSseServer({
      secondEventDelayMs: 10_000,
    });
    cleanups.push(() => oldLocalSseServer.close());
    const proxerServer = await startServer({
      listenAddress: randomAddress,
      token: "dev-token",
    });
    cleanups.push(() => proxerServer.close());
    const oldTunnelClient = await startHttpTunnelClient({
      localPort: oldLocalSseServer.port,
      reconnectDelayMs: 60_000,
      serverUrl: proxerServer.controlUrl,
      subdomain: "demo",
      token: "dev-token",
    });
    cleanups.push(() => oldTunnelClient.close());
    const { firstChunk, fullResponse } = requestSse(proxerServer.publicUrl);

    await expect(firstChunk).resolves.toBe("data: one\n\n");

    await oldTunnelClient.close();
    const interruptedBody = await withTimeout(
      fullResponse.then((response) => response.body).catch(() => undefined),
      1_000,
      "in-flight SSE stream did not end promptly after tunnel disconnect",
    );

    expect(interruptedBody).not.toBe("data: one\n\ndata: two\n\n");

    const newLocalSseServer = await createLocalSseServer();
    cleanups.push(() => newLocalSseServer.close());
    const newTunnelClient = await startHttpTunnelClient({
      localPort: newLocalSseServer.port,
      serverUrl: proxerServer.controlUrl,
      subdomain: "demo",
      token: "dev-token",
    });
    cleanups.push(() => newTunnelClient.close());
    const newStream = requestSse(proxerServer.publicUrl);

    await expect(newStream.firstChunk).resolves.toBe("data: one\n\n");
    await expect(newStream.fullResponse).resolves.toMatchObject({
      body: "data: one\n\ndata: two\n\n",
      status: 200,
    });
  });
});
