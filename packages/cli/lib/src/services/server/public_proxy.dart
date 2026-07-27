import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/server/basic_auth.dart';
import 'package:proxer/src/services/server/request_context.dart';
import 'package:proxer/src/services/server/route_target.dart';
import 'package:proxer/src/services/server/stream_registry.dart';
import 'package:proxer/src/services/server/trusted_proxies.dart';
import 'package:proxer/src/util/headers.dart';

const int defaultStreamTimeoutMs = 30000;

String _streamId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  return base64Url.encode(bytes).replaceAll('=', '');
}

String _routeDescription(TunnelRoute route) {
  return switch (route) {
    RootTunnelRoute() => 'root domain',
    SubdomainTunnelRoute(:final subdomain) => 'subdomain $subdomain',
  };
}

Future<void> _plain(HttpResponse response, int status, String body) async {
  response
    ..statusCode = status
    ..headers.contentType = ContentType.text
    ..write(body);
  await response.close();
}

Future<void> handlePublicRequest({
  required HttpRequest request,
  required TunnelRegistry registry,
  required TrustedProxyConfig trustedProxies,
  String? domain,
  int streamTimeoutMs = defaultStreamTimeoutMs,
  void Function(String message)? log,
}) async {
  final context = getRequestContext(
    request: request,
    trustedProxies: trustedProxies,
  );
  final route = parseTunnelRouteFromHost(context.host, domain);
  if (route == null) {
    await _plain(
      request.response,
      HttpStatus.notFound,
      'No tunnel route matched host ${context.host ?? "missing host"}\n',
    );
    return;
  }
  final tunnel = registry.get(route);
  if (tunnel == null) {
    await _plain(
      request.response,
      HttpStatus.notFound,
      'No tunnel registered for ${_routeDescription(route)}\n',
    );
    return;
  }
  final authorized = verifyBasicAuthHeader(
    request.headers.value(HttpHeaders.authorizationHeader),
    tunnel.basicAuth,
  );
  if (!authorized) {
    await writeBasicAuthChallenge(request.response);
    return;
  }
  if (WebSocketTransformer.isUpgradeRequest(request)) {
    await _proxyWebSocket(
      request: request,
      tunnel: tunnel,
      context: context,
      streamTimeoutMs: streamTimeoutMs,
      stripAuthorization: tunnel.basicAuth != null,
      log: log,
    );
    return;
  }
  await _proxyHttp(
    request: request,
    tunnel: tunnel,
    context: context,
    streamTimeoutMs: streamTimeoutMs,
    stripAuthorization: tunnel.basicAuth != null,
    log: log,
  );
}

Future<void> _proxyHttp({
  required HttpRequest request,
  required RegisteredTunnel tunnel,
  required RequestContext context,
  required int streamTimeoutMs,
  required bool stripAuthorization,
  void Function(String message)? log,
}) async {
  final streamId = _streamId();
  final response = request.response;
  var responseStarted = false;
  var finished = false;
  late final StreamSubscription<TunnelFrame> frames;
  late final StreamSubscription<Object?> closed;
  Timer? timer;
  var frameQueue = Future<void>.value();

  Future<void> cleanup() async {
    if (finished) {
      return;
    }
    finished = true;
    timer?.cancel();
    await frames.cancel();
    await closed.cancel();
  }

  Future<void> handleFrame(TunnelFrame frame) async {
    if (!_frameMatches(frame, streamId)) {
      return;
    }
    switch (frame) {
      case HeadersFrame():
        timer?.cancel();
        responseStarted = true;
        response.statusCode = frame.status;
        for (final entry in frame.headers.entries) {
          response.headers.set(entry.key, entry.value);
        }
      case DataFrame() when frame.direction == 'response':
        response.add(base64.decode(frame.data));
        await response.flush();
      case EndFrame() when frame.direction == 'response':
        await cleanup();
        await response.close();
      case ErrorFrame():
        await cleanup();
        if (!responseStarted) {
          response
            ..statusCode = HttpStatus.badGateway
            ..headers.contentType = ContentType.text
            ..write('${frame.message}\n');
        }
        await response.close();
      case CloseFrame():
        await cleanup();
        if (!responseStarted) {
          response
            ..statusCode = HttpStatus.badGateway
            ..headers.contentType = ContentType.text
            ..write('Tunnel stream closed\n');
        }
        await response.close();
      default:
        break;
    }
  }

  frames = tunnel.connection.frames.listen((frame) {
    frameQueue = frameQueue.then((_) => handleFrame(frame));
  });
  closed = tunnel.connection.closed.listen((error) async {
    if (finished) {
      return;
    }
    await cleanup();
    if (!responseStarted) {
      response
        ..statusCode = HttpStatus.badGateway
        ..headers.contentType = ContentType.text
        ..write('${error ?? "Tunnel connection closed"}\n');
    }
    await response.close();
  });
  timer = Timer(Duration(milliseconds: streamTimeoutMs), () async {
    if (finished || responseStarted) {
      return;
    }
    await tunnel.connection.send(CloseFrame(streamId: streamId));
    await cleanup();
    response
      ..statusCode = HttpStatus.badGateway
      ..headers.contentType = ContentType.text
      ..write('Tunnel response timed out\n');
    await response.close();
  });

  final headers = stripHttpHopByHopHeaders(
    normalizeIncomingHeaders(request.headers),
  );
  if (stripAuthorization) {
    headers.remove(HttpHeaders.authorizationHeader);
  }
  await tunnel.connection.send(
    OpenFrame(
      streamId: streamId,
      kind: 'http',
      method: request.method,
      path: request.uri.toString(),
      headers: applyForwardedHeaders(
        headers,
        clientIp: context.clientIp,
        host: context.host,
        protocol: context.protocol,
      ),
    ),
  );
  try {
    await for (final chunk in request) {
      await tunnel.connection.send(
        DataFrame(
          streamId: streamId,
          direction: 'request',
          data: base64.encode(chunk),
        ),
      );
    }
    await tunnel.connection.send(
      EndFrame(streamId: streamId, direction: 'request'),
    );
  } on Object {
    await tunnel.connection.send(CloseFrame(streamId: streamId));
    await cleanup();
  }
  log?.call('${request.method} ${request.uri.path} opened');
}

bool _frameMatches(TunnelFrame frame, String expected) {
  return switch (frame) {
    HeadersFrame(:final streamId) ||
    DataFrame(:final streamId) ||
    EndFrame(:final streamId) ||
    ErrorFrame(:final streamId) ||
    CloseFrame(:final streamId) => streamId == expected,
    _ => false,
  };
}

Future<void> _proxyWebSocket({
  required HttpRequest request,
  required RegisteredTunnel tunnel,
  required RequestContext context,
  required int streamTimeoutMs,
  required bool stripAuthorization,
  void Function(String message)? log,
}) async {
  final streamId = _streamId();
  final socket = await request.response.detachSocket(writeHeaders: false);
  var finished = false;
  var responseStarted = false;
  late final StreamSubscription<TunnelFrame> frames;
  late final StreamSubscription<Object?> closed;
  late final StreamSubscription<List<int>> socketData;
  Timer? timer;

  Future<void> cleanup() async {
    if (finished) {
      return;
    }
    finished = true;
    timer?.cancel();
    await frames.cancel();
    await closed.cancel();
    await socketData.cancel();
  }

  frames = tunnel.connection.frames.listen((frame) async {
    if (!_frameMatches(frame, streamId)) {
      return;
    }
    switch (frame) {
      case DataFrame() when frame.direction == 'response':
        responseStarted = true;
        timer?.cancel();
        socket.add(base64.decode(frame.data));
      case EndFrame() when frame.direction == 'response':
        await cleanup();
        await socket.close();
      case ErrorFrame() || CloseFrame():
        await cleanup();
        socket.destroy();
      default:
        break;
    }
  });
  closed = tunnel.connection.closed.listen((_) async {
    await cleanup();
    socket.destroy();
  });
  socketData = socket.listen(
    (chunk) {
      unawaited(
        tunnel.connection.send(
          DataFrame(
            streamId: streamId,
            direction: 'request',
            data: base64.encode(chunk),
          ),
        ),
      );
    },
    onDone: () async {
      if (!finished) {
        await tunnel.connection.send(CloseFrame(streamId: streamId));
        await cleanup();
      }
    },
    onError: (Object _) async {
      if (!finished) {
        await tunnel.connection.send(CloseFrame(streamId: streamId));
        await cleanup();
      }
    },
    cancelOnError: false,
  );
  timer = Timer(Duration(milliseconds: streamTimeoutMs), () async {
    if (!responseStarted) {
      await tunnel.connection.send(CloseFrame(streamId: streamId));
      await cleanup();
      socket.destroy();
    }
  });

  final headers = normalizeIncomingHeaders(request.headers);
  if (stripAuthorization) {
    headers.remove(HttpHeaders.authorizationHeader);
  }
  await tunnel.connection.send(
    OpenFrame(
      streamId: streamId,
      kind: 'websocket',
      method: request.method,
      path: request.uri.toString(),
      headers: applyForwardedHeaders(
        headers,
        clientIp: context.clientIp,
        host: context.host,
        protocol: context.protocol,
      ),
    ),
  );
  log?.call('WS ${request.uri.path} opened');
}
