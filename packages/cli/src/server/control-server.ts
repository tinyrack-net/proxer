import http from "node:http";
import { WebSocketServer } from "ws";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import type { RegisterFrame } from "#app/protocol/frame.ts";
import { createWebSocketTunnelConnection } from "#app/protocol/tunnel-connection.ts";
import type { TunnelRoute } from "#app/server/route-target.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";

export type ControlServerOptions = {
  readonly address?: HostPort;
  readonly registry: TunnelRegistry;
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

export const createControlWebSocketServer = ({
  registry,
  token,
}: Omit<ControlServerOptions, "address">): WebSocketServer => {
  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on("connection", (socket) => {
    const connection = createWebSocketTunnelConnection(socket);
    let registeredRoute: TunnelRoute | undefined;

    connection.onFrame((frame) => {
      if (registeredRoute) {
        return;
      }

      if (!isRegisterFrame(frame)) {
        void connection.close(1002, "Expected register frame");
        return;
      }

      if (token !== undefined && frame.token !== token) {
        void connection.close(1008, "Invalid tunnel token");
        return;
      }

      const route: TunnelRoute = frame.subdomain
        ? { type: "subdomain", subdomain: frame.subdomain }
        : { type: "root" };

      try {
        registry.register({ route, connection });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void connection
          .send({ type: "error", streamId: "registration", message })
          .finally(() => connection.close(1008, message));
        return;
      }

      registeredRoute = route;
      void connection.send({
        type: "registered",
        ...(route.type === "subdomain" ? { subdomain: route.subdomain } : {}),
      });
    });

    connection.onClose(() => {
      if (registeredRoute) {
        registry.unregister(registeredRoute, connection);
      }
    });
  });

  return webSocketServer;
};

export const startControlServer = async ({
  address,
  registry,
  token,
}: ControlServerOptions & {
  readonly address: HostPort;
}): Promise<ControlServerHandle> => {
  const server = http.createServer();
  const webSocketServer = createControlWebSocketServer({ registry, token });
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
