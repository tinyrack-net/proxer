import http from "node:http";
import { WebSocketServer } from "ws";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import { formatRoutePrefix, type RuntimeLogger } from "#app/lib/logging.ts";
import { secureCompare } from "#app/lib/secure-compare.ts";
import type { RegisterFrame } from "#app/protocol/frame.ts";
import { createWebSocketTunnelConnection } from "#app/protocol/tunnel-connection.ts";
import type { TunnelRoute } from "#app/server/route-target.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";

export type ControlServerOptions = {
  readonly address?: HostPort;
  readonly logger?: RuntimeLogger;
  readonly maxPayloadBytes?: number;
  readonly registry: TunnelRegistry;
  readonly registerTimeoutMs?: number;
  readonly token?: string;
};

export type ControlServerHandle = {
  readonly url: string;
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

const getListeningAddress = (server: http.Server): HostPort => {
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new ProxerError("Control server did not bind to a TCP address");
  }

  return {
    host: address.address,
    port: address.port,
  };
};

const isRegisterFrame = (frame: {
  readonly type: string;
}): frame is RegisterFrame => {
  return frame.type === "register";
};

const DEFAULT_REGISTER_TIMEOUT_MS = 7_500;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

const routeName = (route: TunnelRoute): string => route.type;

const duplicateReason = (route: TunnelRoute): string => {
  return route.type === "root" ? "duplicate-root" : "duplicate-subdomain";
};

export const createControlWebSocketServer = ({
  logger,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  registry,
  registerTimeoutMs = DEFAULT_REGISTER_TIMEOUT_MS,
  token,
}: Omit<ControlServerOptions, "address">): WebSocketServer => {
  let activeClients = 0;
  const webSocketServer = new WebSocketServer({
    maxPayload: maxPayloadBytes,
    noServer: true,
  });

  webSocketServer.on("connection", (socket, request) => {
    const connection = createWebSocketTunnelConnection(socket);
    let registeredRoute: TunnelRoute | undefined;
    let registeredAt = 0;
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const registerTimer = setTimeout(() => {
      void connection.close(1008, "Tunnel registration timed out");
    }, registerTimeoutMs);
    registerTimer.unref();

    const clearRegisterTimer = () => clearTimeout(registerTimer);

    connection.onFrame((frame) => {
      if (registeredRoute) {
        return;
      }

      if (!isRegisterFrame(frame)) {
        void connection.close(1002, "Expected register frame");
        return;
      }

      if (token !== undefined && !secureCompare(token, frame.token)) {
        logger?.info(
          `client rejected reason=invalid-token remote=${remoteAddress}`,
        );
        void connection.close(1008, "Invalid tunnel token");
        return;
      }

      const route: TunnelRoute = frame.subdomain
        ? { type: "subdomain", subdomain: frame.subdomain }
        : { type: "root" };

      try {
        registry.register({
          ...(frame.basicAuth ? { basicAuth: frame.basicAuth } : {}),
          connection,
          route,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.info(
          `${formatRoutePrefix(route)} client rejected reason=${duplicateReason(route)} remote=${remoteAddress}`,
        );
        void connection
          .send({ type: "error", streamId: "registration", message })
          .finally(() => connection.close(1008, message));
        return;
      }

      registeredRoute = route;
      registeredAt = Date.now();
      activeClients += 1;
      clearRegisterTimer();
      logger?.info(
        `${formatRoutePrefix(route)} client connected route=${routeName(route)} remote=${remoteAddress} active=${activeClients}`,
      );
      void connection.send({
        type: "registered",
        ...(route.type === "subdomain" ? { subdomain: route.subdomain } : {}),
      });
    });

    connection.onClose(() => {
      clearRegisterTimer();
      if (registeredRoute) {
        registry.unregister(registeredRoute, connection);
        activeClients -= 1;
        logger?.info(
          `${formatRoutePrefix(registeredRoute)} client disconnected duration=${Date.now() - registeredAt}ms active=${activeClients}`,
        );
      }
    });
  });

  return webSocketServer;
};

export const startControlServer = async ({
  address,
  logger,
  maxPayloadBytes,
  registry,
  registerTimeoutMs,
  token,
}: ControlServerOptions & {
  readonly address: HostPort;
}): Promise<ControlServerHandle> => {
  const server = http.createServer();
  const webSocketServer = createControlWebSocketServer({
    logger,
    maxPayloadBytes,
    registry,
    registerTimeoutMs,
    token,
  });
  server.on("upgrade", (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  await listen(server, address);
  const listeningAddress = getListeningAddress(server);

  return {
    url: `ws://${formatHostPort(listeningAddress)}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((webSocketError) => {
          if (webSocketError) {
            reject(webSocketError);
            return;
          }

          server.close((serverError) => {
            if (serverError) {
              reject(serverError);
              return;
            }

            resolve();
          });
        });
      });
    },
  };
};
