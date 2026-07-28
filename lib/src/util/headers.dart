import 'dart:io';

typedef HeaderMap = Map<String, List<String>>;

const Set<String> _hopByHopHeaders = {
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
};

HeaderMap normalizeIncomingHeaders(HttpHeaders headers) {
  final normalized = <String, List<String>>{};
  headers.forEach((name, values) {
    normalized[name.toLowerCase()] = List<String>.from(values);
  });
  return normalized;
}

HeaderMap stripHttpHopByHopHeaders(HeaderMap headers) {
  final named = <String>{};
  for (final value in headers['connection'] ?? const <String>[]) {
    named.addAll(
      value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .where((item) => item.isNotEmpty),
    );
  }
  return {
    for (final entry in headers.entries)
      if (!_hopByHopHeaders.contains(entry.key.toLowerCase()) &&
          !named.contains(entry.key.toLowerCase()))
        entry.key.toLowerCase(): entry.value,
  };
}

HeaderMap applyForwardedHeaders(
  HeaderMap headers, {
  required String clientIp,
  required String? host,
  required String protocol,
}) {
  final normalized = <String, List<String>>{};
  const forwarded = {
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
  };
  for (final entry in headers.entries) {
    if (!forwarded.contains(entry.key.toLowerCase())) {
      normalized[entry.key.toLowerCase()] = entry.value;
    }
  }
  if (clientIp.isNotEmpty) {
    normalized['x-forwarded-for'] = [clientIp];
  }
  if (host != null) {
    normalized['x-forwarded-host'] = [host];
  }
  normalized['x-forwarded-proto'] = [protocol];
  return normalized;
}

String serializeHeadersForRawHttp(HeaderMap headers) {
  final buffer = StringBuffer();
  for (final entry in headers.entries) {
    for (final value in entry.value) {
      buffer.write('${entry.key}: $value\r\n');
    }
  }
  return buffer.toString();
}
