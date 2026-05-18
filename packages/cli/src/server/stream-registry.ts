import { ProxerError } from "#app/lib/error.ts";
import type { TunnelConnection } from "#app/protocol/tunnel-connection.ts";
import { type TunnelRoute, tunnelRouteKey } from "#app/server/route-target.ts";

export type TunnelBasicAuth = {
  readonly password: string;
  readonly username?: string;
};

export type RegisteredTunnel = {
  readonly route: TunnelRoute;
  readonly connection: TunnelConnection;
  readonly basicAuth?: TunnelBasicAuth;
};

export class DuplicateTunnelRouteError extends ProxerError {
  readonly route: TunnelRoute;

  constructor(route: TunnelRoute, message = duplicateRouteMessage(route)) {
    super(message);
    this.name = "DuplicateTunnelRouteError";
    this.route = route;
  }
}

export class TunnelRegistry {
  readonly #tunnels = new Map<string, RegisteredTunnel>();

  register(tunnel: RegisteredTunnel): void {
    const key = tunnelRouteKey(tunnel.route);
    if (this.#tunnels.has(key)) {
      throw new DuplicateTunnelRouteError(tunnel.route);
    }

    this.#tunnels.set(key, tunnel);
  }

  unregister(route: TunnelRoute, connection?: TunnelConnection): void {
    const key = tunnelRouteKey(route);
    const tunnel = this.#tunnels.get(key);
    if (!tunnel) {
      return;
    }

    if (connection && tunnel.connection !== connection) {
      return;
    }

    this.#tunnels.delete(key);
  }

  get(route: TunnelRoute): RegisteredTunnel | undefined {
    return this.#tunnels.get(tunnelRouteKey(route));
  }
}

const duplicateRouteMessage = (route: TunnelRoute): string => {
  if (route.type === "root") {
    return "Tunnel root domain is already registered";
  }

  return `Tunnel subdomain "${route.subdomain}" is already registered`;
};
