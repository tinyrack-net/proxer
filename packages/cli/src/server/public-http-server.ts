import http from "node:http";
import type { Duplex } from "node:stream";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import {
  applyForwardedHeaders,
  normalizeIncomingHeaders,
  stripHttpHopByHopHeaders,
} from "#app/lib/headers.ts";
import { createStreamId } from "#app/lib/ids.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import {
  getRequestContext,
  type RequestContext,
} from "#app/server/request-context.ts";
import {
  parseTunnelRouteFromHost,
  type TunnelRoute,
} from "#app/server/route-target.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";
import {
  parseTrustedProxyValues,
  type TrustedProxyConfig,
} from "#app/server/trusted-proxies.ts";
import { attachWebSocketUpgradeHandler } from "#app/server/websocket-upgrade.ts";

export type PublicHttpServerOptions = {
  readonly address: HostPort;
  readonly domain?: string;
  readonly registry: TunnelRegistry;
  readonly streamTimeoutMs?: number;
  readonly trustedProxies?: TrustedProxyConfig;
};

export type PublicHttpServerHandle = {
  readonly url: string;
  close(): Promise<void>;
};

export const DEFAULT_STREAM_TIMEOUT_MS = 30_000;

const listen = async (
  server: http.Server,
  address: HostPort,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address.port, address.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
};

export const getPublicListeningAddress = (server: http.Server): HostPort => {
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new ProxerError("Public HTTP server did not bind to a TCP address");
  }

  return {
    host: address.address,
    port: address.port,
  };
};

const getHostValue = (host: string | string[] | undefined): string => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  return hostValue ?? "";
};

const routeDescription = (route: TunnelRoute): string => {
  return route.type === "root" ? "root domain" : `subdomain ${route.subdomain}`;
};

const endWithNoRoute = (
  response: http.ServerResponse,
  host: string | string[] | undefined,
): void => {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end(
    `No tunnel route matched host ${getHostValue(host) || "missing host"}\n`,
  );
};

const endWithNoTunnel = (
  response: http.ServerResponse,
  route: TunnelRoute,
): void => {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end(`No tunnel registered for ${routeDescription(route)}\n`);
};

const encodeData = (chunk: string | Buffer): string => {
  return Buffer.from(chunk).toString("base64");
};

const handleTunnelFrame = ({
  cleanup,
  frame,
  markResponseStarted,
  response,
  streamId,
}: {
  readonly cleanup: () => void;
  readonly frame: TunnelFrame;
  readonly markResponseStarted: () => void;
  readonly response: http.ServerResponse;
  readonly streamId: string;
}): void => {
  if (!("streamId" in frame) || frame.streamId !== streamId) {
    return;
  }

  switch (frame.type) {
    case "headers":
      markResponseStarted();
      response.writeHead(frame.status, frame.headers);
      return;
    case "data":
      if (frame.direction === "response") {
        response.write(Buffer.from(frame.data, "base64"));
      }
      return;
    case "end":
      if (frame.direction === "response") {
        cleanup();
        response.end();
      }
      return;
    case "error":
      cleanup();
      if (response.headersSent) {
        response.destroy(new Error(frame.message));
        return;
      }
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${frame.message}\n`);
      return;
    case "close":
      cleanup();
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("Tunnel stream closed\n");
      return;
    case "open":
      return;
  }
};

const proxyHttpRequest = ({
  connection,
  requestContext,
  request,
  response,
  streamTimeoutMs,
}: {
  readonly connection: TunnelConnection;
  readonly requestContext: RequestContext;
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly streamTimeoutMs: number;
}): void => {
  const streamId = createStreamId();
  let cleanedUp = false;
  let closeSent = false;
  let sendQueue = Promise.resolve();
  let removeFrameListener: () => void = () => {};
  let removeCloseListener: () => void = () => {};
  const sendFrame = (frame: TunnelFrame): void => {
    sendQueue = sendQueue.then(() => connection.send(frame));
    sendQueue.catch((error: unknown) => {
      if (response.writableEnded || response.destroyed) {
        return;
      }

      if (!response.headersSent) {
        response.writeHead(502, {
          "content-type": "text/plain; charset=utf-8",
        });
      }
      response.end(
        `${error instanceof Error ? error.message : "Tunnel send failed"}\n`,
      );
    });
  };
  const sendCloseFrame = (): void => {
    if (closeSent) {
      return;
    }

    closeSent = true;
    sendFrame({ streamId, type: "close" });
  };
  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    removeFrameListener();
    removeCloseListener();
    clearTimeout(responseStartTimer);
  };
  const markResponseStarted = (): void => {
    clearTimeout(responseStartTimer);
  };
  const responseStartTimer = setTimeout(() => {
    cleanup();
    sendCloseFrame();
    if (response.writableEnded || response.destroyed) {
      return;
    }

    if (response.headersSent) {
      response.destroy(new Error("Tunnel response timed out"));
      return;
    }

    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("Tunnel response timed out\n");
  }, streamTimeoutMs);

  removeFrameListener = connection.onFrame((frame) => {
    handleTunnelFrame({
      cleanup,
      frame,
      markResponseStarted,
      response,
      streamId,
    });
  });
  removeCloseListener = connection.onClose((error) => {
    cleanup();
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`${error?.message ?? "Tunnel connection closed"}\n`);
  });
  request.on("data", (chunk: Buffer) => {
    sendFrame({
      data: encodeData(chunk),
      direction: "request",
      streamId,
      type: "data",
    });
  });
  request.on("end", () => {
    sendFrame({ direction: "request", streamId, type: "end" });
  });
  request.on("aborted", () => {
    cleanup();
    sendCloseFrame();
  });
  response.on("close", () => {
    if (!cleanedUp && !response.writableEnded) {
      cleanup();
      sendCloseFrame();
    }
  });

  sendFrame({
    headers: applyForwardedHeaders(
      stripHttpHopByHopHeaders(normalizeIncomingHeaders(request.headers)),
      requestContext,
    ),
    kind: "http",
    method: request.method ?? "GET",
    path: request.url ?? "/",
    streamId,
    type: "open",
  });
};

export const handlePublicHttpRequest = ({
  domain,
  registry,
  request,
  response,
  streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
  trustedProxies = parseTrustedProxyValues([]),
}: {
  readonly domain?: string;
  readonly registry: TunnelRegistry;
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly streamTimeoutMs?: number;
  readonly trustedProxies?: TrustedProxyConfig;
}): void => {
  const requestContext = getRequestContext({
    defaultProtocol: "http",
    headers: request.headers,
    remoteAddress: request.socket.remoteAddress,
    trustedProxies,
  });
  const route = parseTunnelRouteFromHost(requestContext.host, domain);
  if (!route) {
    endWithNoRoute(response, requestContext.host);
    return;
  }

  const tunnel = registry.get(route);
  if (!tunnel) {
    endWithNoTunnel(response, route);
    return;
  }

  proxyHttpRequest({
    connection: tunnel.connection,
    requestContext,
    request,
    response,
    streamTimeoutMs,
  });
};

export const startPublicHttpServer = async ({
  address,
  domain,
  registry,
  streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
  trustedProxies = parseTrustedProxyValues([]),
}: PublicHttpServerOptions): Promise<PublicHttpServerHandle> => {
  const upgradeSockets = new Set<Duplex>();
  const server = http.createServer((request, response) => {
    handlePublicHttpRequest({
      domain,
      registry,
      request,
      response,
      streamTimeoutMs,
      trustedProxies,
    });
  });
  attachWebSocketUpgradeHandler(server, {
    onSocket(socket) {
      upgradeSockets.add(socket);
      socket.once("close", () => upgradeSockets.delete(socket));
    },
    domain,
    registry,
    trustedProxies,
  });

  await listen(server, address);
  const listeningAddress = getPublicListeningAddress(server);

  return {
    url: `http://${formatHostPort(listeningAddress)}`,
    async close() {
      for (const socket of upgradeSockets) {
        socket.destroy();
      }
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
