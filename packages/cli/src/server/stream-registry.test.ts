import { describe, expect, it } from "vitest";
import { ProxerError } from "#app/lib/error.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import {
  DuplicateTunnelRouteError,
  TunnelRegistry,
} from "#app/server/stream-registry.ts";

const createConnection = (): TunnelConnection => ({
  async send(_frame: TunnelFrame) {},
  async close(_code?: number, _reason?: string) {},
  onFrame(_listener: (frame: TunnelFrame) => void) {
    return () => {};
  },
  onClose(_listener: (error?: Error) => void) {
    return () => {};
  },
});

describe("TunnelRegistry", () => {
  it("registers a tunnel by explicit route", () => {
    const registry = new TunnelRegistry();
    const connection = createConnection();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({ route, connection });

    expect(registry.get(route)).toEqual({ route, connection });
  });

  it("stores basic auth requirements with a registered tunnel", () => {
    const registry = new TunnelRegistry();
    const connection = createConnection();

    registry.register({
      basicAuth: { password: "secret", username: "admin" },
      connection,
      route: { type: "subdomain", subdomain: "demo" },
    });

    expect(
      registry.get({ type: "subdomain", subdomain: "demo" })?.basicAuth,
    ).toEqual({ password: "secret", username: "admin" });
  });

  it("rejects duplicate active subdomain routes", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({ route, connection: createConnection() });

    expect(() =>
      registry.register({ route, connection: createConnection() }),
    ).toThrow(ProxerError);
    expect(() =>
      registry.register({ route, connection: createConnection() }),
    ).toThrow('Tunnel subdomain "demo" is already registered');
  });

  it("rejects duplicate active routes with a typed duplicate route error", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({ route, connection: createConnection() });

    expect(() =>
      registry.register({ route, connection: createConnection() }),
    ).toThrow(DuplicateTunnelRouteError);
  });

  it("rejects duplicate root routes", () => {
    const registry = new TunnelRegistry();
    const route = { type: "root" } as const;

    registry.register({ route, connection: createConnection() });

    expect(() =>
      registry.register({ route, connection: createConnection() }),
    ).toThrow("Tunnel root domain is already registered");
  });

  it("unregisters a tunnel by exact route", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({ route, connection: createConnection() });
    registry.unregister(route);

    expect(registry.get(route)).toBeUndefined();
  });

  it("does not unregister a replaced connection when connection does not match", () => {
    const registry = new TunnelRegistry();
    const originalConnection = createConnection();
    const otherConnection = createConnection();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({ route, connection: originalConnection });
    registry.unregister(route, otherConnection);

    expect(registry.get(route)).toEqual({
      route,
      connection: originalConnection,
    });
  });
});
