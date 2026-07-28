import 'dart:io';

import 'package:proxer/src/services/server/trusted_proxies.dart';

class RequestContext {
  const RequestContext({
    required this.clientIp,
    required this.host,
    required this.protocol,
    required this.trustedProxy,
  });

  final String clientIp;
  final String? host;
  final String protocol;
  final bool trustedProxy;
}

String? _firstHeader(HttpHeaders headers, String name) {
  final value = headers.value(name)?.split(',').first.trim();
  return value == null || value.isEmpty ? null : value;
}

String? _firstValidIp(Iterable<String> values) {
  for (final value in values) {
    for (final candidate in value.split(',')) {
      final ip = candidate.trim();
      try {
        InternetAddress(ip);
        return ip;
      } on ArgumentError {
        // Continue to the next forwarded value.
      }
    }
  }
  return null;
}

String? _clientFromChain(
  Iterable<String> values,
  TrustedProxyConfig trustedProxies,
) {
  final ips = <String>[];
  for (final value in values) {
    for (final candidate in value.split(',')) {
      final ip = candidate.trim();
      try {
        InternetAddress(ip);
        ips.add(ip);
      } on ArgumentError {
        // Ignore malformed forwarded entries.
      }
    }
  }
  if (ips.isEmpty) {
    return null;
  }
  for (final ip in ips.reversed) {
    if (!isTrustedProxy(ip, trustedProxies)) {
      return ip;
    }
  }
  return ips.first;
}

RequestContext getRequestContext({
  required HttpRequest request,
  required TrustedProxyConfig trustedProxies,
  String defaultProtocol = 'http',
}) {
  final remote = request.connectionInfo?.remoteAddress.address;
  final trusted = isTrustedProxy(remote, trustedProxies);
  if (!trusted) {
    return RequestContext(
      clientIp: remote ?? '',
      host: _firstHeader(request.headers, HttpHeaders.hostHeader),
      protocol: defaultProtocol,
      trustedProxy: false,
    );
  }
  final forwardedProto = _firstHeader(
    request.headers,
    'x-forwarded-proto',
  )?.toLowerCase();
  return RequestContext(
    clientIp:
        _clientFromChain(
          request.headers['x-forwarded-for'] ?? const [],
          trustedProxies,
        ) ??
        _firstValidIp(request.headers['x-real-ip'] ?? const []) ??
        remote ??
        '',
    host:
        _firstHeader(request.headers, 'x-forwarded-host') ??
        _firstHeader(request.headers, HttpHeaders.hostHeader),
    protocol: forwardedProto == 'https' || forwardedProto == 'http'
        ? forwardedProto!
        : defaultProtocol,
    trustedProxy: true,
  );
}
