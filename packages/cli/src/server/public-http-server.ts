import http from "node:http";
import { formatHostPort, type HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import {
  normalizeIncomingHeaders,
  stripHttpHopByHopHeaders,
} from "#app/lib/headers.ts";
import { createStreamId } from "#app/lib/ids.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import type { TunnelRegistry } from "#app/server/stream-registry.ts";

export type PublicHttpServerOptions = {
  readonly address: HostPort;
  readonly registry: TunnelRegistry;
  readonly streamTimeoutMs?: number;
};

export type PublicHttpServerHandle = {
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
    throw new ProxerError("Public HTTP server did not bind to a TCP address");
  }

  return {
    host: address.address,
    port: address.port,
  };
};

const getTunnelNameFromHost = (host: string | string[] | undefined): string => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  if (!hostValue) {
    return "";
  }

  const withoutPort = hostValue.split(":")[0] ?? "";
  return withoutPort.split(".")[0] ?? "";
};

const endWithNoTunnel = (response: http.ServerResponse, name: string): void => {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end(`No tunnel registered for ${name || "host"}\n`);
};

const encodeData = (chunk: string | Buffer): string => {
  return Buffer.from(chunk).toString("base64");
};

const handleTunnelFrame = ({
  cleanup,
  frame,
  response,
  streamId,
}: {
  readonly cleanup: () => void;
  readonly frame: TunnelFrame;
  readonly response: http.ServerResponse;
  readonly streamId: string;
}): void => {
  if (!("streamId" in frame) || frame.streamId !== streamId) {
    return;
  }

  switch (frame.type) {
    case "headers":
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
  request,
  response,
}: {
  readonly connection: TunnelConnection;
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
}): void => {
  const streamId = createStreamId();
  let cleanedUp = false;
  let sendQueue = Promise.resolve();
  let removeFrameListener: () => void = () => {};
  let removeCloseListener: () => void = () => {};
  const sendFrame = (frame: TunnelFrame): void => {
    sendQueue = sendQueue.then(() => connection.send(frame));
    sendQueue.catch((error: unknown) => {
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
  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    removeFrameListener();
    removeCloseListener();
  };

  removeFrameListener = connection.onFrame((frame) => {
    handleTunnelFrame({ cleanup, frame, response, streamId });
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
    sendFrame({ streamId, type: "close" });
  });
  response.on("close", () => {
    if (!cleanedUp && !response.writableEnded) {
      cleanup();
      sendFrame({ streamId, type: "close" });
    }
  });

  sendFrame({
    headers: stripHttpHopByHopHeaders(
      normalizeIncomingHeaders(request.headers),
    ),
    kind: "http",
    method: request.method ?? "GET",
    path: request.url ?? "/",
    streamId,
    type: "open",
  });
};

export const startPublicHttpServer = async ({
  address,
  registry,
}: PublicHttpServerOptions): Promise<PublicHttpServerHandle> => {
  const server = http.createServer((request, response) => {
    const name = getTunnelNameFromHost(request.headers.host);
    const tunnel = registry.get(name);
    if (!tunnel) {
      endWithNoTunnel(response, name);
      return;
    }

    proxyHttpRequest({
      connection: tunnel.connection,
      request,
      response,
    });
  });

  await listen(server, address);
  const listeningAddress = getListeningAddress(server);

  return {
    url: `http://${formatHostPort(listeningAddress)}`,
    async close() {
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
