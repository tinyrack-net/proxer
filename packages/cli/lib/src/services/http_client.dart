import 'dart:async';
import 'dart:io';

import 'package:proxer/src/services/client/local_forwarders.dart';
import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/tunnel_connection.dart';
import 'package:proxer/src/util/error.dart';

sealed class HttpClientRouteRequest {
  const HttpClientRouteRequest();
}

class AutoRouteRequest extends HttpClientRouteRequest {
  const AutoRouteRequest();
}

class RootRouteRequest extends HttpClientRouteRequest {
  const RootRouteRequest();
}

class SubdomainRouteRequest extends HttpClientRouteRequest {
  const SubdomainRouteRequest(this.subdomain);

  final String subdomain;
}

class HttpClientConfig {
  const HttpClientConfig({
    required this.localPort,
    required this.serverUrl,
    required this.token,
    this.basicAuth,
    this.mode = RouteMode.single,
    this.route = const AutoRouteRequest(),
    this.heartbeatIntervalMs = 30000,
    this.reconnectDelayMs = 1000,
    this.log,
    this.logError,
  });

  final BasicAuthConfig? basicAuth;
  final int localPort;
  final String serverUrl;
  final RouteMode mode;
  final HttpClientRouteRequest route;
  final String token;
  final int heartbeatIntervalMs;
  final int reconnectDelayMs;
  final void Function(String message)? log;
  final void Function(String message)? logError;
}

class RunningTunnelClient {
  const RunningTunnelClient({required this.subdomain, required this.close});

  final String? subdomain;
  final Future<void> Function() close;
}

class _ActiveConnection {
  const _ActiveConnection({
    required this.connection,
    required this.forwarders,
    required this.route,
  });

  final TunnelConnection connection;
  final LocalForwarders forwarders;
  final HttpClientRouteRequest route;
}

Future<RunningTunnelClient> startHttpTunnelClient(
  HttpClientConfig config,
) async {
  final token = config.token.trim();
  if (token.isEmpty) {
    throw ProxerError('token is required');
  }
  var requestedRoute = config.route;
  _ActiveConnection? active;
  Timer? reconnectTimer;
  var closing = false;

  Future<_ActiveConnection> connect() async {
    config.log?.call('connecting server=${config.serverUrl}');
    final socket = await WebSocket.connect(config.serverUrl);
    if (config.heartbeatIntervalMs > 0) {
      socket.pingInterval = Duration(milliseconds: config.heartbeatIntervalMs);
    }
    final connection = TunnelConnection(socket);
    final completer = Completer<RegisteredFrame>();
    late final StreamSubscription<TunnelFrame> frames;
    late final StreamSubscription<Object?> closed;
    frames = connection.frames.listen((frame) {
      if (frame is RegisteredFrame && !completer.isCompleted) {
        completer.complete(frame);
      } else if (frame is ErrorFrame &&
          frame.streamId == 'registration' &&
          !completer.isCompleted) {
        completer.completeError(ProxerError(frame.message));
      }
    });
    closed = connection.closed.listen((error) {
      if (!completer.isCompleted) {
        completer.completeError(
          error ?? ProxerError('Tunnel registration closed'),
        );
      }
    });
    final routeForRegistration = requestedRoute;
    await connection.send(
      RegisterFrame(
        root: routeForRegistration is RootRouteRequest ? true : null,
        subdomain: routeForRegistration is SubdomainRouteRequest
            ? routeForRegistration.subdomain
            : null,
        mode: config.mode,
        token: token,
        basicAuth: config.basicAuth,
      ),
    );
    RegisteredFrame registered;
    try {
      registered = await completer.future;
    } on Object {
      await connection.close();
      rethrow;
    } finally {
      await frames.cancel();
      await closed.cancel();
    }
    final resolvedRoute = registered.subdomain == null
        ? const RootRouteRequest()
        : SubdomainRouteRequest(registered.subdomain!);
    if (requestedRoute is AutoRouteRequest) {
      if (registered.subdomain == null) {
        await connection.close();
        throw ProxerError('Registered unexpected tunnel "root"');
      }
      requestedRoute = resolvedRoute;
    } else if (requestedRoute is RootRouteRequest &&
        registered.subdomain != null) {
      await connection.close();
      throw ProxerError(
        'Registered unexpected tunnel "${registered.subdomain}"',
      );
    } else if (requestedRoute case SubdomainRouteRequest(:final subdomain)) {
      if (registered.subdomain != subdomain) {
        await connection.close();
        throw ProxerError(
          'Registered unexpected tunnel "${registered.subdomain ?? "root"}"',
        );
      }
    }
    final forwarders = LocalForwarders(
      connection: connection,
      localPort: config.localPort,
      log: config.log,
      logError: config.logError,
    );
    config.log?.call('registered route=${_routeName(resolvedRoute)}');
    return _ActiveConnection(
      connection: connection,
      forwarders: forwarders,
      route: resolvedRoute,
    );
  }

  Future<void> cleanupActive() async {
    final current = active;
    active = null;
    if (current != null) {
      await current.forwarders.close();
    }
  }

  late void Function(_ActiveConnection value) watchClose;

  void scheduleReconnect() {
    if (closing || reconnectTimer != null) {
      return;
    }
    config.log?.call('reconnecting in ${config.reconnectDelayMs}ms');
    reconnectTimer = Timer(
      Duration(milliseconds: config.reconnectDelayMs),
      () async {
        reconnectTimer = null;
        if (closing) {
          return;
        }
        try {
          final next = await connect();
          if (closing) {
            await next.forwarders.close();
            await next.connection.close();
            return;
          }
          active = next;
          watchClose(next);
          config.log?.call('reconnected route=${_routeName(next.route)}');
        } on Object {
          scheduleReconnect();
        }
      },
    );
  }

  void onDisconnected(_ActiveConnection value) {
    if (!identical(active, value) || closing) {
      return;
    }
    unawaited(cleanupActive().then((_) => scheduleReconnect()));
  }

  watchClose = (_ActiveConnection value) {
    unawaited(value.connection.closed.first.then((_) => onDisconnected(value)));
  };

  active = await connect();
  watchClose(active!);
  final initialRoute = active!.route;

  return RunningTunnelClient(
    subdomain: initialRoute is SubdomainRouteRequest
        ? initialRoute.subdomain
        : null,
    close: () async {
      closing = true;
      reconnectTimer?.cancel();
      reconnectTimer = null;
      final current = active;
      await cleanupActive();
      await current?.connection.close();
    },
  );
}

String _routeName(HttpClientRouteRequest route) {
  return switch (route) {
    AutoRouteRequest() => 'auto',
    RootRouteRequest() => 'root',
    SubdomainRouteRequest(:final subdomain) => subdomain,
  };
}
