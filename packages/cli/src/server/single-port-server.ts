import http from "node:http";
import type { Duplex } from "node:stream";
import { CONTROL_PATH, PROXER_INTERNAL_PREFIX } from "#app/config/constants.ts";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import { createControlWebSocketServer } from "#app/server/control-server.ts";
import { handleHealthProbeRequest } from "#app/server/health-probes.ts";
import {
  DEFAULT_STREAM_TIMEOUT_MS,
  getPublicListeningAddress,
  handlePublicHttpRequest,
} from "#app/server/public-http-server.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";
import type { TrustedProxyConfig } from "#app/server/trusted-proxies.ts";
import { handlePublicWebSocketUpgrade } from "#app/server/websocket-upgrade.ts";

export type SinglePortServerOptions = {
  readonly listenAddress: HostPort;
  readonly registry: TunnelRegistry;
  readonly domain?: string;
  readonly token?: string;
  readonly streamTimeoutMs?: number;
  readonly trustedProxies?: TrustedProxyConfig;
};

export type SinglePortServerHandle = {
  readonly publicUrl: string;
  readonly controlUrl: string;
  close(): Promise<void>;
};

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

const pathnameOf = (url: string | undefined): string => {
  return new URL(url ?? "/", "http://localhost").pathname;
};

const isInternalPath = (pathname: string): boolean => {
  return (
    pathname === PROXER_INTERNAL_PREFIX ||
    pathname.startsWith(`${PROXER_INTERNAL_PREFIX}/`)
  );
};

export const startSinglePortServer = async ({
  domain,
  listenAddress,
  registry,
  streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
  token,
  trustedProxies,
}: SinglePortServerOptions): Promise<SinglePortServerHandle> => {
  const upgradeSockets = new Set<Duplex>();
  const controlWebSocketServer = createControlWebSocketServer({
    registry,
    token,
  });
  const server = http.createServer((request, response) => {
    const pathname = pathnameOf(request.url);

    if (handleHealthProbeRequest({ pathname, request, response })) {
      return;
    }

    if (pathname === CONTROL_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Control endpoint requires WebSocket upgrade\n");
      return;
    }

    if (isInternalPath(pathname)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    handlePublicHttpRequest({
      domain,
      registry,
      request,
      response,
      streamTimeoutMs,
      trustedProxies,
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  server.on("upgrade", (request, socket, head) => {
    const pathname = pathnameOf(request.url);

    if (pathname === CONTROL_PATH) {
      controlWebSocketServer.handleUpgrade(
        request,
        socket,
        head,
        (webSocket) => {
          controlWebSocketServer.emit("connection", webSocket, request);
        },
      );
      return;
    }

    if (isInternalPath(pathname)) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }

    handlePublicWebSocketUpgrade(request, socket, head, {
      domain,
      onSocket(upgradeSocket) {
        upgradeSockets.add(upgradeSocket);
        upgradeSocket.once("close", () => upgradeSockets.delete(upgradeSocket));
      },
      registry,
      streamTimeoutMs,
      trustedProxies,
    });
  });

  await listen(server, listenAddress);
  const listeningAddress = getPublicListeningAddress(server);
  const publicUrl = `http://${formatHostPort(listeningAddress)}`;
  const controlUrl = `ws://${formatHostPort(listeningAddress)}${CONTROL_PATH}`;

  return {
    controlUrl,
    publicUrl,
    async close() {
      for (const socket of upgradeSockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        controlWebSocketServer.close((webSocketError) => {
          if (webSocketError) {
            reject(webSocketError);
            return;
          }

          server.close((serverError) => {
            if (
              serverError &&
              !serverError.message.includes("Server is not running")
            ) {
              reject(serverError);
              return;
            }

            resolve();
          });
        });
      }).catch((error: unknown) => {
        if (error instanceof Error) {
          throw error;
        }
        throw new ProxerError(String(error));
      });
    },
  };
};
