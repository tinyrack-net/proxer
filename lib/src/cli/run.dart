import 'dart:async';
import 'dart:io';

import 'package:proxer/src/services/http_client.dart';
import 'package:proxer/src/services/server.dart';
import 'package:proxer/src/util/logging.dart';

Future<void> waitForShutdownSignal() async {
  final streams = <Stream<ProcessSignal>>[ProcessSignal.sigint.watch()];
  if (!Platform.isWindows) {
    streams.add(ProcessSignal.sigterm.watch());
  }
  final subscriptions = <StreamSubscription<ProcessSignal>>[];
  final completer = Completer<void>();
  for (final stream in streams) {
    subscriptions.add(
      stream.listen((_) {
        if (!completer.isCompleted) {
          completer.complete();
        }
      }),
    );
  }
  await completer.future;
  for (final subscription in subscriptions) {
    await subscription.cancel();
  }
}

Future<void> runServer(
  ServerConfig config, {
  required void Function(String message) info,
  required void Function(String message) error,
}) async {
  final running = await startServer(
    ServerConfig(
      listenAddress: config.listenAddress,
      domain: config.domain,
      token: config.token,
      trustedProxies: config.trustedProxies,
      log: info,
    ),
  );
  try {
    info('public: ${running.publicUrl}');
    info('control: ${running.controlUrl}');
    if (config.token == null) {
      info('token: ${running.token}');
    }
    await waitForShutdownSignal();
  } finally {
    await running.close();
    info('server stopped');
  }
}

Future<void> runHttpClient(
  HttpClientConfig config, {
  required void Function(String message) info,
  required void Function(String message) error,
}) async {
  final client = await startHttpTunnelClient(
    HttpClientConfig(
      localPort: config.localPort,
      serverUrl: config.serverUrl,
      token: config.token,
      basicAuth: config.basicAuth,
      mode: config.mode,
      route: config.route,
      log: info,
      logError: error,
    ),
  );
  try {
    if (client.subdomain == null) {
      info('route: root domain');
    } else {
      info('subdomain: ${client.subdomain}');
    }
    info(
      'public: ${derivePublicUrl(serverUrl: config.serverUrl, subdomain: client.subdomain)}',
    );
    info('local: 127.0.0.1:${config.localPort}');
    info('server: ${sanitizeLogUrl(config.serverUrl)}');
    await waitForShutdownSignal();
  } finally {
    await client.close();
    info('http tunnel stopped');
  }
}
