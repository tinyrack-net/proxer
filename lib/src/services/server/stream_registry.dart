import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/tunnel_connection.dart';
import 'package:proxer/src/services/server/route_target.dart';
import 'package:proxer/src/util/error.dart';

class RegisteredTunnel {
  const RegisteredTunnel({
    required this.route,
    required this.connection,
    this.basicAuth,
  });

  final TunnelRoute route;
  final TunnelConnection connection;
  final BasicAuthConfig? basicAuth;
}

class RegisterTunnelResult {
  const RegisterTunnelResult({
    required this.route,
    required this.mode,
    required this.replicas,
  });

  final TunnelRoute route;
  final RouteMode mode;
  final int replicas;
}

class DuplicateTunnelRouteError extends ProxerError {
  DuplicateTunnelRouteError(this.route, [String? message])
    : super(message ?? _duplicateRouteMessage(route));

  final TunnelRoute route;
}

class _RouteEntry {
  _RouteEntry({
    required this.route,
    required this.mode,
    required this.basicAuth,
    required this.tunnels,
  });

  final TunnelRoute route;
  final RouteMode mode;
  final BasicAuthConfig? basicAuth;
  final List<RegisteredTunnel> tunnels;
  int nextIndex = 0;
}

class TunnelRegistry {
  final Map<String, _RouteEntry> _routes = {};

  RegisterTunnelResult register({
    required TunnelRoute route,
    required TunnelConnection connection,
    RouteMode mode = RouteMode.single,
    BasicAuthConfig? basicAuth,
  }) {
    final existing = _routes[route.key];
    final tunnel = RegisteredTunnel(
      route: route,
      connection: connection,
      basicAuth: basicAuth,
    );
    if (existing == null) {
      _routes[route.key] = _RouteEntry(
        route: route,
        mode: mode,
        basicAuth: basicAuth,
        tunnels: [tunnel],
      );
      return RegisterTunnelResult(route: route, mode: mode, replicas: 1);
    }
    if (existing.mode != mode) {
      throw DuplicateTunnelRouteError(
        route,
        '${_duplicateRouteMessage(route)} in ${existing.mode.value} mode',
      );
    }
    if (mode == RouteMode.single) {
      throw DuplicateTunnelRouteError(route);
    }
    if (!_sameBasicAuth(existing.basicAuth, basicAuth)) {
      throw ProxerError('Cluster tunnel basic auth must match existing route');
    }
    existing.tunnels.add(tunnel);
    return RegisterTunnelResult(
      route: existing.route,
      mode: mode,
      replicas: existing.tunnels.length,
    );
  }

  void unregister(TunnelRoute route, [TunnelConnection? connection]) {
    final entry = _routes[route.key];
    if (entry == null) {
      return;
    }
    if (connection == null) {
      _routes.remove(route.key);
      return;
    }
    entry.tunnels.removeWhere(
      (tunnel) => identical(tunnel.connection, connection),
    );
    if (entry.tunnels.isEmpty) {
      _routes.remove(route.key);
    } else {
      entry.nextIndex %= entry.tunnels.length;
    }
  }

  RegisteredTunnel? get(TunnelRoute route) {
    final entry = _routes[route.key];
    if (entry == null) {
      return null;
    }
    if (entry.mode == RouteMode.single) {
      return entry.tunnels.first;
    }
    final tunnel = entry.tunnels[entry.nextIndex % entry.tunnels.length];
    entry.nextIndex = (entry.nextIndex + 1) % entry.tunnels.length;
    return tunnel;
  }
}

String _duplicateRouteMessage(TunnelRoute route) {
  return switch (route) {
    RootTunnelRoute() => 'Tunnel root domain is already registered',
    SubdomainTunnelRoute(:final subdomain) =>
      'Tunnel subdomain "$subdomain" is already registered',
  };
}

bool _sameBasicAuth(BasicAuthConfig? left, BasicAuthConfig? right) {
  return left?.password == right?.password && left?.username == right?.username;
}
