import { describe, expect, it } from "vitest";
import { ProxerError } from "#app/lib/error.ts";
import type { TunnelFrame } from "#app/protocol/frame.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

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
  it("registers a tunnel by name", () => {
    const registry = new TunnelRegistry();
    const connection = createConnection();

    registry.register({ name: "demo", connection });

    expect(registry.get("demo")).toEqual({ name: "demo", connection });
  });

  it("rejects duplicate active tunnel names", () => {
    const registry = new TunnelRegistry();

    registry.register({ name: "demo", connection: createConnection() });

    expect(() =>
      registry.register({ name: "demo", connection: createConnection() }),
    ).toThrow(ProxerError);
    expect(() =>
      registry.register({ name: "demo", connection: createConnection() }),
    ).toThrow('Tunnel "demo" is already registered');
  });

  it("unregisters a tunnel by name", () => {
    const registry = new TunnelRegistry();

    registry.register({ name: "demo", connection: createConnection() });
    registry.unregister("demo");

    expect(registry.get("demo")).toBeUndefined();
  });

  it("does not unregister a replaced connection when connection does not match", () => {
    const registry = new TunnelRegistry();
    const originalConnection = createConnection();
    const otherConnection = createConnection();

    registry.register({ name: "demo", connection: originalConnection });
    registry.unregister("demo", otherConnection);

    expect(registry.get("demo")).toEqual({
      name: "demo",
      connection: originalConnection,
    });
  });
});
