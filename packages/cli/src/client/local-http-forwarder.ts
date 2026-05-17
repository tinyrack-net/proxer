import http from "node:http";
import {
  normalizeIncomingHeaders,
  stripHttpHopByHopHeaders,
} from "#app/lib/headers.ts";
import {
  formatRoutePrefix,
  type LogRoute,
  type RuntimeLogger,
  sanitizeLogPath,
} from "#app/lib/logging.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";

export type LocalHttpForwarderOptions = {
  readonly localPort: number;
  readonly connection: TunnelConnection;
  readonly logger?: RuntimeLogger;
  readonly route?: LogRoute;
};

type ActiveLocalRequest = {
  readonly request: http.ClientRequest;
};

const sendResponseFrame = (
  connection: TunnelConnection,
  frame: TunnelFrame,
): void => {
  void connection.send(frame);
};

const silentLogger: RuntimeLogger = {
  info() {},
  error() {},
};

const getErrorCode = (error: Error): string => {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "error";
};

export const attachLocalHttpForwarder = ({
  connection,
  localPort,
  logger = silentLogger,
  route,
}: LocalHttpForwarderOptions): (() => void) => {
  const activeRequests = new Map<string, ActiveLocalRequest>();

  const removeFrameListener = connection.onFrame((frame) => {
    if (frame.type === "open" && frame.kind === "http") {
      const routePrefix = formatRoutePrefix(route);
      const path = sanitizeLogPath(frame.path);
      logger.info(
        `${routePrefix} ${frame.method} ${path} -> local 127.0.0.1:${localPort}`,
      );
      const localRequest = http.request(
        {
          headers: frame.headers,
          host: "127.0.0.1",
          method: frame.method,
          path: frame.path,
          port: localPort,
        },
        (localResponse) => {
          logger.info(
            `${routePrefix} ${frame.method} ${path} <- ${localResponse.statusCode ?? 502}`,
          );
          sendResponseFrame(connection, {
            headers: stripHttpHopByHopHeaders(
              normalizeIncomingHeaders(localResponse.headers),
            ),
            status: localResponse.statusCode ?? 502,
            streamId: frame.streamId,
            type: "headers",
          });
          localResponse.on("data", (chunk: Buffer) => {
            sendResponseFrame(connection, {
              data: Buffer.from(chunk).toString("base64"),
              direction: "response",
              streamId: frame.streamId,
              type: "data",
            });
          });
          localResponse.on("end", () => {
            activeRequests.delete(frame.streamId);
            sendResponseFrame(connection, {
              direction: "response",
              streamId: frame.streamId,
              type: "end",
            });
          });
        },
      );

      localRequest.on("error", (error) => {
        activeRequests.delete(frame.streamId);
        logger.error(
          `${routePrefix} ${frame.method} ${path} local error ${getErrorCode(error)}`,
        );
        sendResponseFrame(connection, {
          message: error.message,
          streamId: frame.streamId,
          type: "error",
        });
      });
      activeRequests.set(frame.streamId, { request: localRequest });
      return;
    }

    if (!("streamId" in frame)) {
      return;
    }

    const activeRequest = activeRequests.get(frame.streamId);
    if (!activeRequest) {
      return;
    }

    if (frame.type === "data" && frame.direction === "request") {
      activeRequest.request.write(Buffer.from(frame.data, "base64"));
      return;
    }

    if (frame.type === "end" && frame.direction === "request") {
      activeRequest.request.end();
      return;
    }

    if (frame.type === "close") {
      activeRequests.delete(frame.streamId);
      activeRequest.request.destroy();
    }
  });

  return () => {
    removeFrameListener();
    for (const activeRequest of activeRequests.values()) {
      activeRequest.request.destroy();
    }
    activeRequests.clear();
  };
};
