import http from "node:http";
import type { Duplex } from "node:stream";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { normalizeControlPath } from "#app/lib/control-path.ts";
import { ProxerError } from "#app/lib/error.ts";
import { createControlWebSocketServer } from "#app/server/control-server.ts";
import { handleHealthProbeRequest } from "#app/server/health-probes.ts";
import {
  DEFAULT_STREAM_TIMEOUT_MS,
  getPublicListeningAddress,
  handlePublicHttpRequest,
} from "#app/server/public-http-server.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";
import { handlePublicWebSocketUpgrade } from "#app/server/websocket-upgrade.ts";

export type SinglePortServerOptions = {
  readonly listenAddress: HostPort;
  readonly registry: TunnelRegistry;
  readonly controlPath?: string;
  readonly token?: string;
  readonly streamTimeoutMs?: number;
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

export const startSinglePortServer = async ({
  controlPath: inputControlPath,
  listenAddress,
  registry,
  streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
  token,
}: SinglePortServerOptions): Promise<SinglePortServerHandle> => {
  const controlPath = normalizeControlPath(inputControlPath);
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

    if (pathname === controlPath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Control endpoint requires WebSocket upgrade\n");
      return;
    }

    handlePublicHttpRequest({ registry, request, response, streamTimeoutMs });
  });

  server.on("upgrade", (request, socket, head) => {
    if (pathnameOf(request.url) === controlPath) {
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

    handlePublicWebSocketUpgrade(request, socket, head, {
      onSocket(upgradeSocket) {
        upgradeSockets.add(upgradeSocket);
        upgradeSocket.once("close", () => upgradeSockets.delete(upgradeSocket));
      },
      registry,
    });
  });

  await listen(server, listenAddress);
  const listeningAddress = getPublicListeningAddress(server);
  const publicUrl = `http://${formatHostPort(listeningAddress)}`;
  const controlUrl = `ws://${formatHostPort(listeningAddress)}${controlPath}`;

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
