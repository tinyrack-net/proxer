import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/services/server/control.dart';
import 'package:proxer/src/services/server/public_proxy.dart';
import 'package:proxer/src/services/server/stream_registry.dart';
import 'package:proxer/src/services/server/trusted_proxies.dart';
import 'package:proxer/src/util/address.dart';
import 'package:proxer/src/util/error.dart';

class ServerConfig {
  const ServerConfig({
    required this.listenAddress,
    this.domain,
    this.token,
    this.trustedProxies = const [],
    this.log,
  });

  final HostPort listenAddress;
  final String? domain;
  final String? token;
  final List<String> trustedProxies;
  final void Function(String message)? log;
}

class RunningServer {
  const RunningServer({
    required this.publicUrl,
    required this.controlUrl,
    required this.token,
    required this.close,
  });

  final String publicUrl;
  final String controlUrl;
  final String token;
  final Future<void> Function() close;
}

String _generateToken() {
  final random = Random.secure();
  final bytes = List<int>.generate(32, (_) => random.nextInt(256));
  return base64Url.encode(bytes).replaceAll('=', '');
}

Future<void> _handleHealth(HttpRequest request, String probe) async {
  if (request.method != 'GET' && request.method != 'HEAD') {
    request.response
      ..statusCode = HttpStatus.methodNotAllowed
      ..headers.set(HttpHeaders.allowHeader, 'GET, HEAD')
      ..headers.contentType = ContentType.text
      ..write('Method not allowed\n');
    await request.response.close();
    return;
  }
  final body = jsonEncode({'probe': probe, 'status': 'ok'});
  request.response
    ..statusCode = HttpStatus.ok
    ..headers.contentType = ContentType.json
    ..headers.contentLength = utf8.encode(body).length;
  if (request.method != 'HEAD') {
    request.response.write(body);
  }
  await request.response.close();
}

Future<RunningServer> startServer(ServerConfig config) async {
  final token = config.token?.trim() ?? _generateToken();
  if (token.isEmpty) {
    throw ProxerError('token must not be empty');
  }
  final registry = TunnelRegistry();
  final trusted = parseTrustedProxyValues(config.trustedProxies);
  final server = await HttpServer.bind(
    config.listenAddress.host,
    config.listenAddress.port,
  );
  server
    ..idleTimeout = const Duration(seconds: 5)
    ..autoCompress = false;
  final connections = <Future<void>>{};

  final requestSubscription = server.listen((request) {
    final path = request.uri.path;
    Future<void> task;
    if (path == healthLivePath) {
      task = _handleHealth(request, 'live');
    } else if (path == healthReadyPath) {
      task = _handleHealth(request, 'ready');
    } else if (path == controlPath &&
        WebSocketTransformer.isUpgradeRequest(request)) {
      task = acceptControlConnection(
        request: request,
        registry: registry,
        token: token,
        log: config.log,
      ).then((_) {});
    } else if (path == controlPath) {
      task = _writeText(
        request.response,
        HttpStatus.notFound,
        'Control endpoint requires WebSocket upgrade\n',
      );
    } else if (path == proxerInternalPrefix ||
        path.startsWith('$proxerInternalPrefix/')) {
      task = _writeText(request.response, HttpStatus.notFound, 'Not found\n');
    } else {
      task = handlePublicRequest(
        request: request,
        registry: registry,
        trustedProxies: trusted,
        domain: config.domain,
        log: config.log,
      );
    }
    connections.add(task);
    unawaited(
      task
          .catchError((Object error) async {
            try {
              request.response
                ..statusCode = HttpStatus.internalServerError
                ..headers.contentType = ContentType.text
                ..write('${formatProxerError(error)}\n');
            } on StateError {
              // The response was already detached or closed.
            }
            try {
              await request.response.close();
            } on StateError {
              // Already closed by the active proxy.
            }
          })
          .whenComplete(() => connections.remove(task)),
    );
  });

  final address = HostPort(server.address.address, server.port);
  return RunningServer(
    publicUrl: 'http://${formatHostPort(address)}',
    controlUrl: 'ws://${formatHostPort(address)}$controlPath',
    token: token,
    close: () async {
      await requestSubscription.cancel();
      await server.close(force: true);
      await Future.wait(connections.toList());
    },
  );
}

Future<void> _writeText(HttpResponse response, int status, String text) async {
  response
    ..statusCode = status
    ..headers.contentType = ContentType.text
    ..write(text);
  await response.close();
}
