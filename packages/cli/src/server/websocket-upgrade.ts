import type http from "node:http";
import type { Duplex } from "node:stream";
import {
  applyForwardedHeaders,
  normalizeWebSocketUpgradeHeaders,
} from "#app/lib/headers.ts";
import { createStreamId } from "#app/lib/ids.ts";
import {
  formatRoutePrefix,
  type RuntimeLogger,
  sanitizeLogPath,
} from "#app/lib/logging.ts";
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
import { DEFAULT_STREAM_TIMEOUT_MS } from "#app/server/stream-timeout.ts";
import {
  parseTrustedProxyValues,
  type TrustedProxyConfig,
} from "#app/server/trusted-proxies.ts";

export type WebSocketUpgradeHandlerOptions = {
  readonly domain?: string;
  readonly logger?: RuntimeLogger;
  readonly registry: TunnelRegistry;
  readonly onSocket?: (socket: Duplex) => void;
  readonly streamTimeoutMs?: number;
  readonly trustedProxies?: TrustedProxyConfig;
};

const getHostValue = (host: string | string[] | undefined): string => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  return hostValue ?? "";
};

const routeDescription = (route: TunnelRoute): string => {
  return route.type === "root" ? "root domain" : `subdomain ${route.subdomain}`;
};

const logWebSocketFailure = ({
  detail,
  logger,
  request,
  route,
}: {
  readonly detail: "no-route" | "no-tunnel";
  readonly logger?: RuntimeLogger;
  readonly request: http.IncomingMessage;
  readonly route?: TunnelRoute;
}): void => {
  logger?.info(
    `${formatRoutePrefix(route)} WS ${sanitizeLogPath(request.url)} -> 404 ${detail}`,
  );
};

const writeNotFoundResponse = (socket: Duplex, message: string): void => {
  socket.write(
    "HTTP/1.1 404 Not Found\r\n" +
      "content-type: text/plain; charset=utf-8\r\n" +
      "connection: close\r\n" +
      "\r\n" +
      `${message}\n`,
    () => socket.destroy(),
  );
};

const encodeData = (chunk: Buffer): string => {
  return chunk.toString("base64");
};

const proxyWebSocketUpgrade = ({
  connection,
  head,
  logger,
  requestContext,
  request,
  route,
  socket,
  streamTimeoutMs,
}: {
  readonly connection: TunnelConnection;
  readonly head: Buffer;
  readonly logger?: RuntimeLogger;
  readonly requestContext: RequestContext;
  readonly request: http.IncomingMessage;
  readonly route: TunnelRoute;
  readonly socket: Duplex;
  readonly streamTimeoutMs: number;
}): void => {
  const startedAt = Date.now();
  const routePrefix = formatRoutePrefix(route);
  const path = sanitizeLogPath(request.url);
  const streamId = createStreamId();
  let cleanedUp = false;
  let streamClosed = false;
  let sendQueue = Promise.resolve();
  let removeFrameListener: () => void = () => {};
  let removeCloseListener: () => void = () => {};

  const sendFrame = (frame: TunnelFrame): void => {
    sendQueue = sendQueue.then(() => connection.send(frame));
    sendQueue.catch(() => {
      cleanup();
      socket.destroy();
    });
  };
  const sendCloseFrame = (): void => {
    if (streamClosed) {
      return;
    }
    streamClosed = true;
    sendFrame({ streamId, type: "close" });
  };
  const onSocketData = (chunk: Buffer): void => {
    sendFrame({
      data: encodeData(chunk),
      direction: "request",
      streamId,
      type: "data",
    });
  };
  const onSocketClose = (): void => {
    sendCloseFrame();
    cleanup();
  };
  const onSocketError = (): void => {
    sendCloseFrame();
    cleanup();
  };
  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    logger?.info(
      `${routePrefix} WS ${path} closed ${Date.now() - startedAt}ms`,
    );
    removeFrameListener();
    removeCloseListener();
    socket.off("data", onSocketData);
    socket.off("close", onSocketClose);
    socket.off("end", onSocketClose);
    socket.off("error", onSocketError);
    clearTimeout(responseStartTimer);
  };
  const markResponseStarted = (): void => {
    clearTimeout(responseStartTimer);
  };
  const responseStartTimer = setTimeout(() => {
    cleanup();
    sendCloseFrame();
    socket.destroy();
  }, streamTimeoutMs);

  removeFrameListener = connection.onFrame((frame) => {
    if (!("streamId" in frame) || frame.streamId !== streamId) {
      return;
    }

    if (frame.type === "data" && frame.direction === "response") {
      markResponseStarted();
      socket.write(Buffer.from(frame.data, "base64"));
      return;
    }

    if (frame.type === "end" && frame.direction === "response") {
      cleanup();
      socket.end();
      return;
    }

    if (frame.type === "error" || frame.type === "close") {
      cleanup();
      socket.destroy();
    }
  });
  removeCloseListener = connection.onClose(() => {
    cleanup();
    socket.destroy();
  });
  socket.on("data", onSocketData);
  socket.on("close", onSocketClose);
  socket.on("end", onSocketClose);
  socket.on("error", onSocketError);
  logger?.info(`${routePrefix} WS ${path} opened`);

  sendFrame({
    headers: applyForwardedHeaders(
      normalizeWebSocketUpgradeHeaders(request.headers),
      requestContext,
    ),
    kind: "websocket",
    method: request.method ?? "GET",
    path: request.url ?? "/",
    streamId,
    type: "open",
  });
  if (head.length > 0) {
    onSocketData(head);
  }
};

export const handlePublicWebSocketUpgrade = (
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  {
    domain,
    logger,
    onSocket,
    registry,
    streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
    trustedProxies = parseTrustedProxyValues([]),
  }: WebSocketUpgradeHandlerOptions,
): void => {
  onSocket?.(socket);
  const requestContext = getRequestContext({
    defaultProtocol: "http",
    headers: request.headers,
    remoteAddress: request.socket.remoteAddress,
    trustedProxies,
  });
  const route = parseTunnelRouteFromHost(requestContext.host, domain);
  if (!route) {
    writeNotFoundResponse(
      socket,
      `No tunnel route matched host ${getHostValue(requestContext.host) || "missing host"}`,
    );
    logWebSocketFailure({ detail: "no-route", logger, request });
    return;
  }

  const tunnel = registry.get(route);
  if (!tunnel) {
    writeNotFoundResponse(
      socket,
      `No tunnel registered for ${routeDescription(route)}`,
    );
    logWebSocketFailure({ detail: "no-tunnel", logger, request, route });
    return;
  }

  proxyWebSocketUpgrade({
    connection: tunnel.connection,
    head,
    logger,
    requestContext,
    request,
    route,
    socket,
    streamTimeoutMs,
  });
};

export const attachWebSocketUpgradeHandler = (
  server: http.Server,
  options: WebSocketUpgradeHandlerOptions,
): void => {
  server.on("upgrade", (request, socket, head) => {
    handlePublicWebSocketUpgrade(request, socket, head, options);
  });
};
