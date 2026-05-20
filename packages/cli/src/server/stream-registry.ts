import { ProxerError } from "#app/lib/error.ts";
import type { RouteMode } from "#app/protocol/frame.ts";
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

export type TunnelRegistration = RegisteredTunnel & {
  readonly mode?: RouteMode;
};

export type RegisterTunnelResult = {
  readonly route: TunnelRoute;
  readonly mode: RouteMode;
  readonly replicas: number;
};

type RouteEntry = {
  readonly route: TunnelRoute;
  readonly mode: RouteMode;
  readonly basicAuth?: TunnelBasicAuth;
  readonly tunnels: RegisteredTunnel[];
  nextIndex: number;
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
  readonly #routes = new Map<string, RouteEntry>();

  register(tunnel: TunnelRegistration): RegisterTunnelResult {
    const key = tunnelRouteKey(tunnel.route);
    const mode = tunnel.mode ?? "single";
    const existing = this.#routes.get(key);
    const registeredTunnel: RegisteredTunnel = {
      ...(tunnel.basicAuth ? { basicAuth: tunnel.basicAuth } : {}),
      connection: tunnel.connection,
      route: tunnel.route,
    };

    if (!existing) {
      this.#routes.set(key, {
        ...(tunnel.basicAuth ? { basicAuth: tunnel.basicAuth } : {}),
        mode,
        nextIndex: 0,
        route: tunnel.route,
        tunnels: [registeredTunnel],
      });
      return { route: tunnel.route, mode, replicas: 1 };
    }

    if (existing.mode !== mode) {
      throw new DuplicateTunnelRouteError(
        tunnel.route,
        duplicateRouteMessage(tunnel.route, existing.mode),
      );
    }

    if (mode === "single") {
      throw new DuplicateTunnelRouteError(tunnel.route);
    }

    if (!sameBasicAuth(existing.basicAuth, tunnel.basicAuth)) {
      throw new ProxerError(
        "Cluster tunnel basic auth must match existing route",
      );
    }

    existing.tunnels.push(registeredTunnel);
    return {
      route: existing.route,
      mode: existing.mode,
      replicas: existing.tunnels.length,
    };
  }

  unregister(route: TunnelRoute, connection?: TunnelConnection): void {
    const key = tunnelRouteKey(route);
    const entry = this.#routes.get(key);
    if (!entry) {
      return;
    }

    if (!connection) {
      this.#routes.delete(key);
      return;
    }

    const tunnelIndex = entry.tunnels.findIndex(
      (tunnel) => tunnel.connection === connection,
    );
    if (tunnelIndex === -1) {
      return;
    }

    entry.tunnels.splice(tunnelIndex, 1);
    if (entry.tunnels.length === 0) {
      this.#routes.delete(key);
      return;
    }

    entry.nextIndex %= entry.tunnels.length;
  }

  get(route: TunnelRoute): RegisteredTunnel | undefined {
    const entry = this.#routes.get(tunnelRouteKey(route));
    if (!entry) {
      return undefined;
    }

    if (entry.mode === "single") {
      return entry.tunnels[0];
    }

    const tunnel = entry.tunnels[entry.nextIndex % entry.tunnels.length];
    entry.nextIndex = (entry.nextIndex + 1) % entry.tunnels.length;
    return tunnel;
  }
}

const duplicateRouteMessage = (
  route: TunnelRoute,
  mode?: RouteMode,
): string => {
  const modeSuffix = mode === undefined ? "" : ` in ${mode} mode`;
  if (route.type === "root") {
    return `Tunnel root domain is already registered${modeSuffix}`;
  }

  return `Tunnel subdomain "${route.subdomain}" is already registered${modeSuffix}`;
};

const sameBasicAuth = (
  left: TunnelBasicAuth | undefined,
  right: TunnelBasicAuth | undefined,
): boolean => {
  return (
    left?.password === right?.password && left?.username === right?.username
  );
};
