import { WebSocket } from "ws";
import { attachLocalHttpForwarder } from "#app/client/local-http-forwarder.ts";
import { attachLocalWebSocketForwarder } from "#app/client/local-websocket-forwarder.ts";
import { ProxerError } from "#app/lib/error.ts";
import { createWebSocketTunnelConnection } from "#app/protocol/tunnel-connection.ts";

export type HttpClientConfig = {
  readonly localPort: number;
  readonly serverUrl: string;
  readonly name: string;
  readonly token?: string;
};

export type RunningTunnelClient = {
  readonly name: string;
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

export const startHttpTunnelClient = async ({
  localPort,
  name,
  serverUrl,
  token,
}: HttpClientConfig): Promise<RunningTunnelClient> => {
  const socket = await openWebSocket(serverUrl);
  const connection = createWebSocketTunnelConnection(socket);
  let removeRegistrationFrameListener: () => void = () => {};
  let removeRegistrationCloseListener: () => void = () => {};

  try {
    await new Promise<void>((resolve, reject) => {
      removeRegistrationFrameListener = connection.onFrame((frame) => {
        if (frame.type === "registered" && frame.name === name) {
          resolve();
          return;
        }

        if (frame.type === "registered") {
          reject(
            new ProxerError(`Registered unexpected tunnel "${frame.name}"`),
          );
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
        .send({ type: "register", name, token })
        .catch((error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  } catch (error) {
    removeRegistrationFrameListener();
    removeRegistrationCloseListener();
    socket.close();
    throw error;
  }

  removeRegistrationFrameListener();
  removeRegistrationCloseListener();
  const detachLocalHttpForwarder = attachLocalHttpForwarder({
    connection,
    localPort,
  });
  const detachLocalWebSocketForwarder = attachLocalWebSocketForwarder({
    connection,
    localPort,
  });

  return {
    name,
    async close() {
      detachLocalWebSocketForwarder();
      detachLocalHttpForwarder();
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }
      await connection.close();
    },
  };
};
