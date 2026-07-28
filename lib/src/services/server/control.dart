import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/subdomain.dart';
import 'package:proxer/src/services/protocol/tunnel_connection.dart';
import 'package:proxer/src/services/server/route_target.dart';
import 'package:proxer/src/services/server/stream_registry.dart';
import 'package:proxer/src/util/error.dart';

const int defaultRegisterTimeoutMs = 7500;
const int defaultRandomSubdomainMaxAttempts = 10;

String _randomSubdomain() {
  final random = Random.secure();
  final bytes = List<int>.generate(8, (_) => random.nextInt(256));
  final value = base64Url
      .encode(bytes)
      .replaceAll('=', '')
      .toLowerCase()
      .replaceAll('_', '0');
  return 'px-$value';
}

bool _secureCompare(String? left, String? right) {
  final a = utf8.encode(left ?? '');
  final b = utf8.encode(right ?? '');
  var difference = a.length ^ b.length;
  final length = max(a.length, b.length);
  for (var index = 0; index < length; index += 1) {
    difference |=
        (index < a.length ? a[index] : 0) ^ (index < b.length ? b[index] : 0);
  }
  return difference == 0;
}

Future<TunnelConnection> acceptControlConnection({
  required HttpRequest request,
  required TunnelRegistry registry,
  required String token,
  void Function(String message)? log,
  String Function() generateSubdomain = _randomSubdomain,
  int registerTimeoutMs = defaultRegisterTimeoutMs,
  int randomSubdomainMaxAttempts = defaultRandomSubdomainMaxAttempts,
}) async {
  final socket = await WebSocketTransformer.upgrade(request);
  final connection = TunnelConnection(socket);
  final registered = Completer<TunnelConnection>();
  TunnelRoute? registeredRoute;
  final remote = request.connectionInfo?.remoteAddress.address ?? 'unknown';
  late final StreamSubscription<TunnelFrame> frameSubscription;
  StreamSubscription<Object?>? closeSubscription;
  final timer = Timer(Duration(milliseconds: registerTimeoutMs), () {
    unawaited(connection.close(1008, 'Tunnel registration timed out'));
    if (!registered.isCompleted) {
      registered.completeError(ProxerError('Tunnel registration timed out'));
    }
  });

  frameSubscription = connection.frames.listen((frame) async {
    if (registeredRoute != null) {
      return;
    }
    if (frame is! RegisterFrame) {
      await connection.close(1002, 'Expected register frame');
      if (!registered.isCompleted) {
        registered.completeError(ProxerError('Expected register frame'));
      }
      return;
    }
    if (!_secureCompare(token, frame.token)) {
      log?.call('client rejected reason=invalid-token remote=$remote');
      await connection.close(1008, 'Invalid tunnel token');
      if (!registered.isCompleted) {
        registered.completeError(ProxerError('Invalid tunnel token'));
      }
      return;
    }

    TunnelRoute? route = frame.root == true
        ? const RootTunnelRoute()
        : frame.subdomain == null
        ? null
        : SubdomainTunnelRoute(frame.subdomain!);
    RegisterTunnelResult? result;
    try {
      if (route != null) {
        result = registry.register(
          route: route,
          connection: connection,
          mode: frame.mode ?? RouteMode.single,
          basicAuth: frame.basicAuth,
        );
      } else {
        for (
          var attempt = 0;
          attempt < randomSubdomainMaxAttempts;
          attempt += 1
        ) {
          final candidate = generateSubdomain();
          if (!isTunnelSubdomain(candidate)) {
            continue;
          }
          final generatedRoute = SubdomainTunnelRoute(candidate);
          try {
            result = registry.register(
              route: generatedRoute,
              connection: connection,
              mode: frame.mode ?? RouteMode.single,
              basicAuth: frame.basicAuth,
            );
            route = generatedRoute;
            break;
          } on DuplicateTunnelRouteError catch (error) {
            if (error.route != generatedRoute) {
              rethrow;
            }
          }
        }
        if (route == null || result == null) {
          throw ProxerError('Could not allocate a random tunnel subdomain');
        }
      }
    } on ProxerError catch (error) {
      await connection.send(
        ErrorFrame(streamId: 'registration', message: error.message),
      );
      await connection.close(1008, error.message);
      if (!registered.isCompleted) {
        registered.completeError(error);
      }
      return;
    }

    registeredRoute = route;
    timer.cancel();
    await connection.send(
      RegisteredFrame(
        subdomain: route is SubdomainTunnelRoute ? route.subdomain : null,
        mode: result.mode,
        replicas: result.replicas,
      ),
    );
    log?.call('client connected route=${route.key} remote=$remote');
    if (!registered.isCompleted) {
      registered.complete(connection);
    }
  });

  closeSubscription = connection.closed.listen((_) {
    timer.cancel();
    final route = registeredRoute;
    if (route != null) {
      registry.unregister(route, connection);
      log?.call('client disconnected route=${route.key} remote=$remote');
    } else if (!registered.isCompleted) {
      registered.completeError(ProxerError('Tunnel registration closed'));
    }
    unawaited(frameSubscription.cancel());
    unawaited(closeSubscription?.cancel());
  });

  return registered.future;
}
