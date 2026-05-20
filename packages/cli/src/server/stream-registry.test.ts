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

  it("rejects explicit single duplicate routes with the original message", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      route,
      connection: createConnection(),
      mode: "single",
    });

    expect(() =>
      registry.register({
        route,
        connection: createConnection(),
        mode: "single",
      }),
    ).toThrow('Tunnel subdomain "demo" is already registered');
  });

  it("treats missing mode as single when an explicit single exists", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      route,
      connection: createConnection(),
      mode: "single",
    });

    expect(() =>
      registry.register({ route, connection: createConnection() }),
    ).toThrow('Tunnel subdomain "demo" is already registered');
  });

  it("accepts multiple cluster connections for the same route", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();

    expect(
      registry.register({
        route,
        connection: firstConnection,
        mode: "cluster",
      }),
    ).toEqual({ route, mode: "cluster", replicas: 1 });
    expect(
      registry.register({
        route,
        connection: secondConnection,
        mode: "cluster",
      }),
    ).toEqual({ route, mode: "cluster", replicas: 2 });

    expect(registry.get(route)?.connection).toBe(firstConnection);
    expect(registry.get(route)?.connection).toBe(secondConnection);
    expect(registry.get(route)?.connection).toBe(firstConnection);
  });

  it("rejects mixed single and cluster registrations", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      route,
      connection: createConnection(),
      mode: "cluster",
    });

    expect(() =>
      registry.register({
        route,
        connection: createConnection(),
        mode: "single",
      }),
    ).toThrow('Tunnel subdomain "demo" is already registered in cluster mode');

    const otherRegistry = new TunnelRegistry();
    otherRegistry.register({ route, connection: createConnection() });

    expect(() =>
      otherRegistry.register({
        route,
        connection: createConnection(),
        mode: "cluster",
      }),
    ).toThrow('Tunnel subdomain "demo" is already registered in single mode');
  });

  it("keeps remaining cluster replicas after unregistering one connection", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();
    registry.register({ route, connection: firstConnection, mode: "cluster" });
    registry.register({ route, connection: secondConnection, mode: "cluster" });

    registry.unregister(route, firstConnection);

    expect(registry.get(route)?.connection).toBe(secondConnection);
  });

  it("round-robins across three cluster replicas", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();
    const thirdConnection = createConnection();

    registry.register({ route, connection: firstConnection, mode: "cluster" });
    registry.register({ route, connection: secondConnection, mode: "cluster" });
    registry.register({ route, connection: thirdConnection, mode: "cluster" });

    expect(registry.get(route)?.connection).toBe(firstConnection);
    expect(registry.get(route)?.connection).toBe(secondConnection);
    expect(registry.get(route)?.connection).toBe(thirdConnection);
    expect(registry.get(route)?.connection).toBe(firstConnection);
  });

  it("ignores unregister calls for non-member cluster connections", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();

    registry.register({ route, connection: firstConnection, mode: "cluster" });
    registry.register({ route, connection: secondConnection, mode: "cluster" });
    registry.unregister(route, createConnection());

    expect(registry.get(route)?.connection).toBe(firstConnection);
    expect(registry.get(route)?.connection).toBe(secondConnection);
  });

  it("removes a cluster route after all replicas unregister", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();

    registry.register({ route, connection: firstConnection, mode: "cluster" });
    registry.register({ route, connection: secondConnection, mode: "cluster" });
    registry.unregister(route, firstConnection);
    registry.unregister(route, secondConnection);

    expect(registry.get(route)).toBeUndefined();
  });

  it("supports root routes with multiple cluster replicas", () => {
    const registry = new TunnelRegistry();
    const route = { type: "root" } as const;
    const firstConnection = createConnection();
    const secondConnection = createConnection();

    registry.register({ route, connection: firstConnection, mode: "cluster" });
    expect(
      registry.register({
        route,
        connection: secondConnection,
        mode: "cluster",
      }),
    ).toEqual({ route, mode: "cluster", replicas: 2 });

    expect(registry.get(route)?.connection).toBe(firstConnection);
    expect(registry.get(route)?.connection).toBe(secondConnection);
  });

  it("rejects cluster replicas with incompatible basic auth", () => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      basicAuth: { password: "secret", username: "admin" },
      route,
      connection: createConnection(),
      mode: "cluster",
    });

    expect(() =>
      registry.register({
        basicAuth: { password: "secret", username: "other" },
        route,
        connection: createConnection(),
        mode: "cluster",
      }),
    ).toThrow("Cluster tunnel basic auth must match existing route");
  });

  it.each([
    ["password-only", { password: "secret" }, { password: "secret" }],
    [
      "username and password",
      { password: "secret", username: "admin" },
      { password: "secret", username: "admin" },
    ],
    ["no auth", undefined, undefined],
  ] as const)("accepts cluster replicas with identical basic auth: %s", (_case, firstAuth, secondAuth) => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      ...(firstAuth ? { basicAuth: firstAuth } : {}),
      route,
      connection: createConnection(),
      mode: "cluster",
    });

    expect(
      registry.register({
        ...(secondAuth ? { basicAuth: secondAuth } : {}),
        route,
        connection: createConnection(),
        mode: "cluster",
      }),
    ).toMatchObject({ mode: "cluster", replicas: 2 });
  });

  it.each([
    ["no auth joining an auth route", { password: "secret" }, undefined],
    ["auth joining a no-auth route", undefined, { password: "secret" }],
    [
      "different username",
      { password: "secret", username: "admin" },
      { password: "secret", username: "other" },
    ],
    ["different password", { password: "secret" }, { password: "other" }],
  ] as const)("rejects cluster replicas with incompatible basic auth: %s", (_case, firstAuth, secondAuth) => {
    const registry = new TunnelRegistry();
    const route = { type: "subdomain", subdomain: "demo" } as const;

    registry.register({
      ...(firstAuth ? { basicAuth: firstAuth } : {}),
      route,
      connection: createConnection(),
      mode: "cluster",
    });

    expect(() =>
      registry.register({
        ...(secondAuth ? { basicAuth: secondAuth } : {}),
        route,
        connection: createConnection(),
        mode: "cluster",
      }),
    ).toThrow("Cluster tunnel basic auth must match existing route");
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
