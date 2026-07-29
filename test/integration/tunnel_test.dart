import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:proxer/src/services/http_client.dart';
import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/server.dart';
import 'package:proxer/src/util/address.dart';
import 'package:test/test.dart';

void main() {
  late HttpServer local;
  late RunningServer proxer;
  late RunningTunnelClient client;

  setUp(() async {
    local = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(
      local.forEach((request) async {
        if (WebSocketTransformer.isUpgradeRequest(request)) {
          final socket = await WebSocketTransformer.upgrade(request);
          socket.listen(socket.add);
          return;
        }
        if (request.uri.path == '/events') {
          request.response.headers
            ..contentType = ContentType(
              'text',
              'event-stream',
              charset: 'utf-8',
            )
            ..set(HttpHeaders.cacheControlHeader, 'no-cache');
          request.response.write('data: one\n\n');
          await request.response.flush();
          await Future<void>.delayed(const Duration(milliseconds: 30));
          request.response.write('data: two\n\n');
          await request.response.close();
          return;
        }
        if (request.uri.path == '/inspect') {
          request.response.write(
            'authorization=${request.headers.value(HttpHeaders.authorizationHeader) ?? "none"};'
            'host=${request.headers.value(HttpHeaders.hostHeader)};'
            'proto=${request.headers.value('x-forwarded-proto')};'
            'for=${request.headers.value('x-forwarded-for')}',
          );
          await request.response.close();
          return;
        }
        final body = await utf8.decodeStream(request);
        request.response
          ..headers.set('x-local', 'yes')
          ..write('${request.method}:${request.uri.path}:$body');
        await request.response.close();
      }),
    );
    proxer = await startServer(
      const ServerConfig(
        listenAddress: HostPort('127.0.0.1', 0),
        domain: 'proxy.localhost',
        token: 'dev-token',
      ),
    );
    client = await startHttpTunnelClient(
      HttpClientConfig(
        localPort: local.port,
        serverUrl: proxer.controlUrl,
        token: 'dev-token',
        route: const SubdomainRouteRequest('demo'),
        heartbeatIntervalMs: 0,
      ),
    );
  });

  tearDown(() async {
    await client.close();
    await proxer.close();
    await local.close(force: true);
  });

  test('proxies HTTP request and response bodies', () async {
    final http = HttpClient();
    final request = await http.postUrl(Uri.parse('${proxer.publicUrl}/hello'));
    request.headers.host = 'demo.proxy.localhost';
    request.write('payload');
    final response = await request.close();
    expect(response.statusCode, 200);
    expect(response.headers.value('x-local'), 'yes');
    expect(await utf8.decodeStream(response), 'POST:/hello:payload');
    http.close(force: true);
  });

  test(
    'returns a not-found response for a host with no matching tunnel',
    () async {
      final http = HttpClient();
      final request = await http.getUrl(Uri.parse(proxer.publicUrl));
      request.headers.host = 'unknown.proxy.localhost';
      final response = await request.close();
      expect(response.statusCode, HttpStatus.notFound);
      await response.drain<void>();
      http.close(force: true);
    },
  );

  test('streams SSE chunks through the tunnel', () async {
    final http = HttpClient();
    final request = await http.getUrl(Uri.parse('${proxer.publicUrl}/events'));
    request.headers.host = 'demo.proxy.localhost';
    final response = await request.close();
    expect(response.statusCode, 200);
    expect(response.headers.contentType?.mimeType, 'text/event-stream');
    expect(await utf8.decodeStream(response), 'data: one\n\ndata: two\n\n');
    http.close(force: true);
  });

  test('passes a raw WebSocket upgrade in both directions', () async {
    final uri = Uri.parse(
      proxer.publicUrl,
    ).replace(scheme: 'ws', path: '/echo');
    final socket = await WebSocket.connect(
      uri.toString(),
      headers: {'Host': 'demo.proxy.localhost'},
    );
    socket.add('hello');
    expect(await socket.first, 'hello');
    await socket.close();
  });

  test('supports root routing and strips consumed Basic Auth', () async {
    await client.close();
    client = await startHttpTunnelClient(
      HttpClientConfig(
        localPort: local.port,
        serverUrl: proxer.controlUrl,
        token: 'dev-token',
        route: const RootRouteRequest(),
        basicAuth: const BasicAuthConfig(password: 'pass', username: 'user'),
        heartbeatIntervalMs: 0,
      ),
    );

    final http = HttpClient();
    final rejected = await http.getUrl(
      Uri.parse('${proxer.publicUrl}/inspect'),
    );
    rejected.headers.host = 'proxy.localhost';
    expect((await rejected.close()).statusCode, HttpStatus.unauthorized);

    final accepted = await http.getUrl(
      Uri.parse('${proxer.publicUrl}/inspect'),
    );
    accepted.headers
      ..host = 'proxy.localhost'
      ..set(
        HttpHeaders.authorizationHeader,
        'Basic ${base64.encode(utf8.encode('user:pass'))}',
      );
    final response = await accepted.close();
    expect(response.statusCode, HttpStatus.ok);
    final body = await utf8.decodeStream(response);
    expect(body, startsWith('authorization=none;host=proxy.localhost'));
    expect(body, contains(';proto=http;for=127.0.0.1'));
    http.close(force: true);
  });

  test('round-robins cluster replicas', () async {
    await client.close();
    client = await startHttpTunnelClient(
      HttpClientConfig(
        localPort: local.port,
        serverUrl: proxer.controlUrl,
        token: 'dev-token',
        mode: RouteMode.cluster,
        route: const SubdomainRouteRequest('demo'),
        heartbeatIntervalMs: 0,
      ),
    );
    final secondLocal = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(
      secondLocal.forEach((request) async {
        await request.drain<void>();
        request.response.write('replica-b');
        await request.response.close();
      }),
    );
    final secondClient = await startHttpTunnelClient(
      HttpClientConfig(
        localPort: secondLocal.port,
        serverUrl: proxer.controlUrl,
        token: 'dev-token',
        mode: RouteMode.cluster,
        route: const SubdomainRouteRequest('demo'),
        heartbeatIntervalMs: 0,
      ),
    );

    try {
      final bodies = <String>[];
      final http = HttpClient();
      for (var index = 0; index < 2; index += 1) {
        final request = await http.getUrl(
          Uri.parse('${proxer.publicUrl}/cluster'),
        );
        request.headers.host = 'demo.proxy.localhost';
        bodies.add(await utf8.decodeStream(await request.close()));
      }
      expect(bodies, contains('GET:/cluster:'));
      expect(bodies, contains('replica-b'));
      http.close(force: true);
    } finally {
      await secondClient.close();
      await secondLocal.close(force: true);
    }
  });
}
