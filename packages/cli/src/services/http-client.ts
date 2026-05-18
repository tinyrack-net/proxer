import { WebSocket } from "ws";
import { attachLocalHttpForwarder } from "#app/client/local-http-forwarder.ts";
import { attachLocalWebSocketForwarder } from "#app/client/local-websocket-forwarder.ts";
import { ProxerError } from "#app/lib/error.ts";
import {
  type LogRoute,
  type RuntimeLogger,
  sanitizeLogUrl,
} from "#app/lib/logging.ts";
import { createWebSocketTunnelConnection } from "#app/protocol/tunnel-connection.ts";

export type HttpClientRouteRequest =
  | { readonly type: "auto" }
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

export type HttpClientConfig = {
  readonly basicAuth?: {
    readonly password: string;
    readonly username?: string;
  };
  readonly localPort: number;
  readonly serverUrl: string;
  readonly route?: HttpClientRouteRequest;
  readonly token?: string;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly logger?: RuntimeLogger;
  readonly reconnectDelayMs?: number;
};

type HttpClientBasicAuth = NonNullable<HttpClientConfig["basicAuth"]>;

type RegisteredRoute =
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

export type RunningTunnelClient = {
  readonly subdomain?: string;
  close(): Promise<void>;
};

const openWebSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return socket;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const silentLogger: RuntimeLogger = {
  info() {},
  error() {},
};

const formatRouteName = (
  route: HttpClientRouteRequest | RegisteredRoute,
): string => {
  if (route.type === "subdomain") {
    return route.subdomain;
  }

  return route.type;
};

const buildRegisterRouteFields = (
  route: HttpClientRouteRequest,
): { readonly root?: true; readonly subdomain?: string } => {
  if (route.type === "root") {
    return { root: true };
  }

  if (route.type === "subdomain") {
    return { subdomain: route.subdomain };
  }

  return {};
};

const resolveRegisteredRoute = (
  frameSubdomain: string | undefined,
  requestedRoute: HttpClientRouteRequest,
): RegisteredRoute => {
  if (requestedRoute.type === "auto") {
    if (frameSubdomain) {
      return { type: "subdomain", subdomain: frameSubdomain };
    }

    throw new ProxerError('Registered unexpected tunnel "root"');
  }

  if (requestedRoute.type === "root") {
    if (frameSubdomain === undefined) {
      return { type: "root" };
    }

    throw new ProxerError(`Registered unexpected tunnel "${frameSubdomain}"`);
  }

  if (frameSubdomain === requestedRoute.subdomain) {
    return { type: "subdomain", subdomain: frameSubdomain };
  }

  throw new ProxerError(
    `Registered unexpected tunnel "${frameSubdomain ?? "root"}"`,
  );
};

const registerConnection = async ({
  basicAuth,
  connection,
  route,
  socket,
  token,
}: {
  readonly basicAuth?: HttpClientBasicAuth;
  readonly connection: ReturnType<typeof createWebSocketTunnelConnection>;
  readonly route: HttpClientRouteRequest;
  readonly socket: WebSocket;
  readonly token?: string;
}): Promise<RegisteredRoute> => {
  let removeRegistrationFrameListener: () => void = () => {};
  let removeRegistrationCloseListener: () => void = () => {};

  try {
    return await new Promise<RegisteredRoute>((resolve, reject) => {
      removeRegistrationFrameListener = connection.onFrame((frame) => {
        if (frame.type === "registered") {
          try {
            resolve(resolveRegisteredRoute(frame.subdomain, route));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
          return;
        }

        if (frame.type === "error" && frame.streamId === "registration") {
          reject(new ProxerError(frame.message));
        }
      });
      removeRegistrationCloseListener = connection.onClose((error) => {
        reject(error ?? new ProxerError("Tunnel registration closed"));
      });
      void connection
        .send({
          type: "register",
          ...(basicAuth ? { basicAuth } : {}),
          ...buildRegisterRouteFields(route),
          token,
        })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    removeRegistrationFrameListener();
    removeRegistrationCloseListener();
  }
};

const startHeartbeat = ({
  intervalMs,
  socket,
  timeoutMs,
}: {
  readonly intervalMs: number;
  readonly socket: WebSocket;
  readonly timeoutMs: number;
}): (() => void) => {
  if (intervalMs <= 0) {
    return () => {};
  }

  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  const clearHeartbeatTimeout = (): void => {
    if (heartbeatTimeout === undefined) {
      return;
    }

    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = undefined;
  };
  const onPong = (): void => {
    clearHeartbeatTimeout();
  };
  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (heartbeatTimeout !== undefined) {
      socket.terminate();
      return;
    }

    socket.ping();
    heartbeatTimeout = setTimeout(() => {
      heartbeatTimeout = undefined;
      socket.terminate();
    }, timeoutMs);
  }, intervalMs);

  socket.on("pong", onPong);

  return () => {
    clearInterval(interval);
    clearHeartbeatTimeout();
    socket.off("pong", onPong);
  };
};

type ActiveTunnelConnection = {
  readonly connection: ReturnType<typeof createWebSocketTunnelConnection>;
  readonly detachLocalHttpForwarder: () => void;
  readonly detachLocalWebSocketForwarder: () => void;
  removeLifecycleCloseListener: () => void;
  readonly route: RegisteredRoute;
  readonly socket: WebSocket;
  readonly stopHeartbeat: () => void;
};

export const startHttpTunnelClient = async ({
  basicAuth,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  localPort,
  logger = silentLogger,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  route = { type: "auto" },
  serverUrl,
  token,
}: HttpClientConfig): Promise<RunningTunnelClient> => {
  const tunnelToken = token?.trim();
  if (!tunnelToken) {
    throw new ProxerError("token is required");
  }
  const logServerUrl = sanitizeLogUrl(serverUrl);
  let routeRequest = route;
  let activeRoute: RegisteredRoute | undefined;

  let activeConnection: ActiveTunnelConnection | undefined;
  let closing = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanupActiveConnection = (): void => {
    if (!activeConnection) {
      return;
    }

    activeConnection.removeLifecycleCloseListener();
    activeConnection.stopHeartbeat();
    activeConnection.detachLocalWebSocketForwarder();
    activeConnection.detachLocalHttpForwarder();
    activeConnection = undefined;
  };

  const connect = async (): Promise<ActiveTunnelConnection> => {
    logger.info(
      `connecting server=${logServerUrl} route=${formatRouteName(routeRequest)}`,
    );
    const socket = await openWebSocket(serverUrl);
    logger.info(`connected server=${logServerUrl}`);
    const connection = createWebSocketTunnelConnection(socket);
    const registeredRoute = await registerConnection({
      basicAuth,
      connection,
      route: routeRequest,
      socket,
      token: tunnelToken,
    });
    activeRoute = registeredRoute;
    if (routeRequest.type === "auto" && registeredRoute.type === "subdomain") {
      routeRequest = {
        type: "subdomain",
        subdomain: registeredRoute.subdomain,
      };
    }
    logger.info(`registered route=${formatRouteName(registeredRoute)}`);
    const logRoute: LogRoute = registeredRoute;
    const detachLocalHttpForwarder = attachLocalHttpForwarder({
      connection,
      localPort,
      logger,
      route: logRoute,
    });
    const detachLocalWebSocketForwarder = attachLocalWebSocketForwarder({
      connection,
      localPort,
      logger,
      route: logRoute,
    });
    const stopHeartbeat = startHeartbeat({
      intervalMs: heartbeatIntervalMs,
      socket,
      timeoutMs: heartbeatTimeoutMs,
    });
    return {
      connection,
      detachLocalHttpForwarder,
      detachLocalWebSocketForwarder,
      removeLifecycleCloseListener: () => {},
      route: registeredRoute,
      socket,
      stopHeartbeat,
    };
  };

  const activateConnection = (active: ActiveTunnelConnection): void => {
    activeConnection = active;
    active.removeLifecycleCloseListener = active.connection.onClose(() => {
      if (activeConnection !== active) {
        return;
      }

      logger.info(`disconnected route=${formatRouteName(active.route)}`);
      cleanupActiveConnection();
      scheduleReconnect();
    });
  };

  const reconnect = async (): Promise<void> => {
    if (closing) {
      return;
    }

    try {
      const nextConnection = await connect();
      activateConnection(nextConnection);
      logger.info(`reconnected route=${formatRouteName(nextConnection.route)}`);
      if (closing) {
        const staleConnection = nextConnection;
        cleanupActiveConnection();
        await staleConnection.connection.close();
      }
    } catch {
      scheduleReconnect();
    }
  };

  function scheduleReconnect(): void {
    if (closing || reconnectTimer !== undefined) {
      return;
    }

    logger.info(`reconnecting in ${reconnectDelayMs}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void reconnect();
    }, reconnectDelayMs);
  }

  activateConnection(await connect());

  return {
    subdomain:
      activeRoute?.type === "subdomain" ? activeRoute.subdomain : undefined,
    async close() {
      closing = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }

      const connectionToClose = activeConnection;
      cleanupActiveConnection();
      if (!connectionToClose) {
        return;
      }

      if (connectionToClose.socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await connectionToClose.connection.close();
    },
  };
};
