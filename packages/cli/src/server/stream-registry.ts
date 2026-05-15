import { ProxerError } from "#app/lib/error.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";

export type RegisteredTunnel = {
  readonly name: string;
  readonly connection: TunnelConnection;
};

export class TunnelRegistry {
  readonly #tunnels = new Map<string, RegisteredTunnel>();

  register(tunnel: RegisteredTunnel): void {
    if (this.#tunnels.has(tunnel.name)) {
      throw new ProxerError(`Tunnel "${tunnel.name}" is already registered`);
    }

    this.#tunnels.set(tunnel.name, tunnel);
  }

  unregister(name: string, connection?: TunnelConnection): void {
    const tunnel = this.#tunnels.get(name);
    if (!tunnel) {
      return;
    }

    if (connection && tunnel.connection !== connection) {
      return;
    }

    this.#tunnels.delete(name);
  }

  get(name: string): RegisteredTunnel | undefined {
    return this.#tunnels.get(name);
  }

  getOnly(): RegisteredTunnel | undefined {
    if (this.#tunnels.size !== 1) {
      return undefined;
    }

    return this.#tunnels.values().next().value;
  }
}
