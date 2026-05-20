import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import type { HostPort } from "#app/lib/address.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { startSinglePortServer } from "#app/server/single-port-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

class FakeTunnelConnection implements TunnelConnection {
  readonly sent: TunnelFrame[] = [];

  async send(frame: TunnelFrame): Promise<void> {
    this.sent.push(frame);
  }

  async close(): Promise<void> {}

  onFrame(): () => void {
    return () => {};
  }

  onClose(): () => void {
    return () => {};
  }
}

const requestSinglePort = async ({
  headers,
  method = "GET",
  path,
  url,
}: {
  readonly headers?: http.OutgoingHttpHeaders;
  readonly method?: string;
  readonly path: string;
  readonly url: string;
}): Promise<{
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly status: number;
}> => {
  const requestUrl = new URL(path, url);

  return await new Promise((resolve, reject) => {
    const request = http.request(
      requestUrl,
      { headers, method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
};

const controlWebSocketUrl = (publicUrl: string, path: string): string => {
  const url = new URL(path, publicUrl);
  url.protocol = "ws:";
  return url.toString();
};

const openWebSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const nextMessage = async (socket: WebSocket): Promise<TunnelFrame> => {
  const data = await new Promise<RawData>((resolve) => {
    socket.once("message", resolve);
  });

  if (Buffer.isBuffer(data)) {
    return decodeFrame(data);
  }

  if (Array.isArray(data)) {
    return decodeFrame(Buffer.concat(data));
  }

  return decodeFrame(Buffer.from(new Uint8Array(data)));
};

const waitForClose = async (socket: WebSocket): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
  });
};

describe("single-port server health probes", () => {
  const handles: Array<{ close(): Promise<void> }> = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(
      sockets.splice(0).map(async (socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
        await waitForClose(socket);
      }),
    );
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it("returns live probe JSON without a registered tunnel", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
      token: "secret",
    });
    handles.push(handle);

    const response = await requestSinglePort({
      path: "/__proxer__/health/live",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({ probe: "live", status: "ok" });
  });

  it("returns ready probe JSON without a registered tunnel", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestSinglePort({
      path: "/__proxer__/health/ready",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({ probe: "ready", status: "ok" });
  });

  it("does not forward probe paths to registered tunnels", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry,
      streamTimeoutMs: 10,
    });
    handles.push(handle);

    const response = await requestSinglePort({
      headers: { host: "demo.localhost" },
      path: "/__proxer__/health/live",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(connection.sent).toEqual([]);
  });

  it("returns probe status and headers without a body for HEAD", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestSinglePort({
      method: "HEAD",
      path: "/__proxer__/health/ready",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.body).toBe("");
  });

  it("returns 405 for non-GET and non-HEAD probe requests", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestSinglePort({
      method: "POST",
      path: "/__proxer__/health/live",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });

  it("returns 404 for old one-underscore health probe paths", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestSinglePort({
      path: "/__proxer/health/live",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(404);
  });

  it("reserves unknown /__proxer__ internal paths from proxied traffic", async () => {
    const registry = new TunnelRegistry();
    const connection = new FakeTunnelConnection();
    registry.register({
      connection,
      route: { type: "root" },
    });
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry,
      streamTimeoutMs: 10,
    });
    handles.push(handle);

    const response = await requestSinglePort({
      path: "/__proxer__/api/future",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(404);
    expect(connection.sent).toEqual([]);
  });

  it("accepts control WebSocket upgrades only on the fixed internal path", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);
    const socket = await openWebSocket(
      controlWebSocketUrl(handle.publicUrl, "/__proxer__/control"),
    );
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", subdomain: "demo" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      mode: "single",
      replicas: 1,
      type: "registered",
      subdomain: "demo",
    });
    await expect(
      openWebSocket(
        controlWebSocketUrl(handle.publicUrl, "/__proxer_control_7f3d9a2b__"),
      ),
    ).rejects.toThrow();
  });

  it("returns 404 for HTTP requests to the fixed control path", async () => {
    const handle = await startSinglePortServer({
      listenAddress: randomAddress,
      registry: new TunnelRegistry(),
    });
    handles.push(handle);

    const response = await requestSinglePort({
      path: "/__proxer__/control",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(404);
    expect(response.body).toContain(
      "Control endpoint requires WebSocket upgrade",
    );
  });
});
