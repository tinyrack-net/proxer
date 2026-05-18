import net from "node:net";
import { serializeHeadersForRawHttp } from "#app/lib/headers.ts";
import {
  formatRoutePrefix,
  type LogRoute,
  type RuntimeLogger,
  sanitizeLogPath,
} from "#app/lib/logging.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";

export type LocalWebSocketForwarderOptions = {
  readonly localPort: number;
  readonly connection: TunnelConnection;
  readonly logger?: RuntimeLogger;
  readonly route?: LogRoute;
};

type ActiveLocalSocket = {
  readonly socket: net.Socket;
};

const sendFrame = (connection: TunnelConnection, frame: TunnelFrame): void => {
  void connection.send(frame).catch(() => {});
};

const silentLogger: RuntimeLogger = {
  info() {},
  error() {},
};

const getErrorCode = (error: Error): string => {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "error";
};

export const attachLocalWebSocketForwarder = ({
  connection,
  localPort,
  logger = silentLogger,
  route,
}: LocalWebSocketForwarderOptions): (() => void) => {
  const activeSockets = new Map<string, ActiveLocalSocket>();

  const removeFrameListener = connection.onFrame((frame) => {
    if (frame.type === "open" && frame.kind === "websocket") {
      const routePrefix = formatRoutePrefix(route);
      const path = sanitizeLogPath(frame.path);
      let loggedClosed = false;
      const logClosed = (): void => {
        if (loggedClosed) {
          return;
        }
        loggedClosed = true;
        logger.info(`${routePrefix} WS ${path} closed`);
      };
      const localSocket = net.connect(localPort, "127.0.0.1");
      activeSockets.set(frame.streamId, { socket: localSocket });

      localSocket.on("connect", () => {
        logger.info(
          `${routePrefix} WS ${path} -> local 127.0.0.1:${localPort} opened`,
        );
        localSocket.write(
          `${frame.method} ${frame.path} HTTP/1.1\r\n` +
            serializeHeadersForRawHttp(frame.headers) +
            "\r\n",
        );
      });
      localSocket.on("data", (chunk: Buffer) => {
        sendFrame(connection, {
          data: Buffer.from(chunk).toString("base64"),
          direction: "response",
          streamId: frame.streamId,
          type: "data",
        });
      });
      localSocket.on("end", () => {
        activeSockets.delete(frame.streamId);
        logClosed();
        sendFrame(connection, {
          direction: "response",
          streamId: frame.streamId,
          type: "end",
        });
      });
      localSocket.on("close", () => {
        activeSockets.delete(frame.streamId);
        logClosed();
        sendFrame(connection, { streamId: frame.streamId, type: "close" });
      });
      localSocket.on("error", (error) => {
        activeSockets.delete(frame.streamId);
        logger.error(
          `${routePrefix} WS ${path} local error ${getErrorCode(error)}`,
        );
        sendFrame(connection, {
          message: error.message,
          streamId: frame.streamId,
          type: "error",
        });
      });
      return;
    }

    if (!("streamId" in frame)) {
      return;
    }

    const activeSocket = activeSockets.get(frame.streamId);
    if (!activeSocket) {
      return;
    }

    if (frame.type === "data" && frame.direction === "request") {
      activeSocket.socket.write(Buffer.from(frame.data, "base64"));
      return;
    }

    if (frame.type === "end" && frame.direction === "request") {
      activeSocket.socket.end();
      return;
    }

    if (frame.type === "close") {
      activeSockets.delete(frame.streamId);
      activeSocket.socket.destroy();
    }
  });

  return () => {
    removeFrameListener();
    for (const activeSocket of activeSockets.values()) {
      activeSocket.socket.destroy();
    }
    activeSockets.clear();
  };
};
