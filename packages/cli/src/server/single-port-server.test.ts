import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
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

describe("single-port server health probes", () => {
  const handles: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
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
      path: "/__proxer/health/live",
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
      path: "/__proxer/health/ready",
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
      path: "/__proxer/health/live",
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
      path: "/__proxer/health/ready",
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
      path: "/__proxer/health/live",
      url: handle.publicUrl,
    });

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });
});
