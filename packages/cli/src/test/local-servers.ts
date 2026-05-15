import http from "node:http";
import type { HostPort } from "#app/lib/address.ts";

export type LocalSseServerOptions = {
  readonly secondEventDelayMs?: number;
  readonly onFirstEventWritten?: () => void;
  readonly onSecondEventWritten?: () => void;
};

const closeHttpServer = async (server: http.Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const listenOnRandomPort = async (
  server: http.Server,
): Promise<HostPort> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("server did not bind to a TCP address");
  }

  return { host: address.address, port: address.port };
};

export const createLocalSseServer = async ({
  onFirstEventWritten,
  onSecondEventWritten,
  secondEventDelayMs = 50,
}: LocalSseServerOptions = {}): Promise<{
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}> => {
  const timers = new Set<NodeJS.Timeout>();
  const server = http.createServer((request, response) => {
    if (request.url !== "/events") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.write("data: one\n\n");
    onFirstEventWritten?.();

    const timer = setTimeout(() => {
      timers.delete(timer);
      response.write("data: two\n\n");
      onSecondEventWritten?.();
      response.end();
    }, secondEventDelayMs);
    timers.add(timer);
  });

  const address = await listenOnRandomPort(server);

  return {
    url: `http://${address.host}:${address.port}`,
    port: address.port,
    async close() {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      await closeHttpServer(server);
    },
  };
};
