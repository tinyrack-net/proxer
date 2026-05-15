import type http from "node:http";
import type { Duplex } from "node:stream";
import { normalizeWebSocketUpgradeHeaders } from "#app/lib/headers.ts";
import { createStreamId } from "#app/lib/ids.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";

export type WebSocketUpgradeHandlerOptions = {
  readonly registry: TunnelRegistry;
  readonly onSocket?: (socket: Duplex) => void;
};

const getTunnelNameFromHost = (host: string | string[] | undefined): string => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  if (!hostValue) {
    return "";
  }

  const withoutPort = hostValue.split(":")[0] ?? "";
  return withoutPort.split(".")[0] ?? "";
};

const writeNoTunnelResponse = (socket: Duplex, name: string): void => {
  socket.write(
    "HTTP/1.1 404 Not Found\r\n" +
      "content-type: text/plain; charset=utf-8\r\n" +
      "connection: close\r\n" +
      "\r\n" +
      `No tunnel registered for ${name || "host"}\n`,
    () => socket.destroy(),
  );
};

const encodeData = (chunk: Buffer): string => {
  return chunk.toString("base64");
};

const proxyWebSocketUpgrade = ({
  connection,
  head,
  request,
  socket,
}: {
  readonly connection: TunnelConnection;
  readonly head: Buffer;
  readonly request: http.IncomingMessage;
  readonly socket: Duplex;
}): void => {
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
    removeFrameListener();
    removeCloseListener();
    socket.off("data", onSocketData);
    socket.off("close", onSocketClose);
    socket.off("end", onSocketClose);
    socket.off("error", onSocketError);
  };

  removeFrameListener = connection.onFrame((frame) => {
    if (!("streamId" in frame) || frame.streamId !== streamId) {
      return;
    }

    if (frame.type === "data" && frame.direction === "response") {
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

  sendFrame({
    headers: normalizeWebSocketUpgradeHeaders(request.headers),
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
  { onSocket, registry }: WebSocketUpgradeHandlerOptions,
): void => {
  onSocket?.(socket);
  const name = getTunnelNameFromHost(request.headers.host);
  const tunnel = registry.get(name) ?? registry.getOnly();
  if (!tunnel) {
    writeNoTunnelResponse(socket, name);
    return;
  }

  proxyWebSocketUpgrade({
    connection: tunnel.connection,
    head,
    request,
    socket,
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
