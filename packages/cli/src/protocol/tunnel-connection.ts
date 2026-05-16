import { type RawData, WebSocket } from "ws";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import {
  decodeFrame,
  encodeFrame,
  ProtocolError,
} from "#app/protocol/frame-codec.ts";

export type TunnelConnection = {
  send(frame: TunnelFrame): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  onFrame(listener: (frame: TunnelFrame) => void): () => void;
  onClose(listener: (error?: Error) => void): () => void;
};

const rawDataToPayload = (data: RawData): string | Buffer | ArrayBuffer => {
  if (
    typeof data === "string" ||
    data instanceof Buffer ||
    data instanceof ArrayBuffer
  ) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
};

export const createWebSocketTunnelConnection = (
  socket: WebSocket,
): TunnelConnection => {
  const frameListeners = new Set<(frame: TunnelFrame) => void>();
  const closeListeners = new Set<(error?: Error) => void>();
  let closeError: Error | undefined;

  socket.on("message", (data) => {
    let frame: TunnelFrame;

    try {
      frame = decodeFrame(rawDataToPayload(data));
    } catch (error) {
      closeError =
        error instanceof Error
          ? error
          : new ProtocolError("Invalid tunnel frame");
      socket.close(1002, closeError.message);
      return;
    }

    for (const listener of frameListeners) {
      listener(frame);
    }
  });

  socket.on("error", (error) => {
    closeError = error instanceof Error ? error : new Error(String(error));
  });

  socket.on("close", () => {
    for (const listener of closeListeners) {
      listener(closeError);
    }
  });

  return {
    async send(frame) {
      await new Promise<void>((resolve, reject) => {
        try {
          socket.send(encodeFrame(frame), (error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    },
    async close(code, reason) {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        if (socket.readyState === WebSocket.CLOSING) {
          return;
        }

        socket.close(code, reason);
      });
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
  };
};
