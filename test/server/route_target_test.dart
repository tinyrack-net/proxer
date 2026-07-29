import 'package:proxer/src/services/server/route_target.dart';
import 'package:test/test.dart';

void main() {
  test('returns null for missing, empty, or malformed authority strings', () {
    for (final host in <String?>[
      null,
      '',
      ' ',
      '[::1]',
      '[::1]:8080',
      'a:b:c',
      'host:abc',
      ':8080',
    ]) {
      expect(
        parseTunnelRouteFromHost(host, 'proxy.localhost'),
        isNull,
        reason: 'host="$host"',
      );
    }
  });

  test('strips a valid numeric port before evaluating the hostname', () {
    final route = parseTunnelRouteFromHost(
      'demo.proxy.localhost:8080',
      'proxy.localhost',
    );
    expect(route, isA<SubdomainTunnelRoute>());
    expect((route as SubdomainTunnelRoute).subdomain, 'demo');
  });

  test(
    'falls back to the first label as subdomain when domain is not configured',
    () {
      final route = parseTunnelRouteFromHost('host:8080', null);
      expect(route, isA<SubdomainTunnelRoute>());
      expect((route as SubdomainTunnelRoute).subdomain, 'host');
    },
  );

  test(
    'falls back to the first label when domain is unset even for multi-label hosts',
    () {
      final route = parseTunnelRouteFromHost('demo.proxy.localhost', null);
      expect(route, isA<SubdomainTunnelRoute>());
      expect((route as SubdomainTunnelRoute).subdomain, 'demo');
    },
  );

  test('treats an exact domain match as the root route', () {
    final route = parseTunnelRouteFromHost(
      'proxy.localhost',
      'proxy.localhost',
    );
    expect(route, isA<RootTunnelRoute>());
    expect(route!.key, 'root');
  });

  test('normalizes host and domain casing before comparison', () {
    final route = parseTunnelRouteFromHost(
      'Demo.Proxy.LOCALHOST',
      'proxy.localhost',
    );
    expect(route, isA<SubdomainTunnelRoute>());
    expect((route as SubdomainTunnelRoute).subdomain, 'demo');
    expect(route.key, 'subdomain:demo');
  });

  test('rejects a host outside the configured domain', () {
    expect(parseTunnelRouteFromHost('other.com', 'proxy.localhost'), isNull);
  });

  test('rejects an empty subdomain prefix', () {
    expect(
      parseTunnelRouteFromHost('.proxy.localhost', 'proxy.localhost'),
      isNull,
    );
  });

  test('rejects multi-level subdomains under a configured domain', () {
    expect(
      parseTunnelRouteFromHost('a.b.proxy.localhost', 'proxy.localhost'),
      isNull,
    );
  });

  test(
    'treats an empty domain string as a literal match target, not "unset"',
    () {
      expect(parseTunnelRouteFromHost('anything', ''), isNull);
      expect(parseTunnelRouteFromHost('proxy.localhost', ''), isNull);
    },
  );

  test(
    'does not validate subdomain label charset — arbitrary characters pass through',
    () {
      final route = parseTunnelRouteFromHost(
        'de_mo.proxy.localhost',
        'proxy.localhost',
      );
      expect(route, isA<SubdomainTunnelRoute>());
      expect((route as SubdomainTunnelRoute).subdomain, 'de_mo');
    },
  );
}
