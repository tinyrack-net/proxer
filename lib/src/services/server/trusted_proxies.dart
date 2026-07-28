import 'dart:io';
import 'dart:typed_data';

import 'package:proxer/src/util/error.dart';

class TrustedProxyRule {
  const TrustedProxyRule(this.network, this.prefixLength);

  final Uint8List network;
  final int prefixLength;
}

class TrustedProxyConfig {
  const TrustedProxyConfig(this.rules);

  final List<TrustedProxyRule> rules;
}

TrustedProxyConfig parseTrustedProxyValues(Iterable<String> values) {
  final expanded = <String>[];
  for (final raw in values) {
    switch (raw.trim().toLowerCase()) {
      case 'loopback':
        expanded.addAll(['127.0.0.0/8', '::1/128']);
      case 'private':
        expanded.addAll([
          '10.0.0.0/8',
          '172.16.0.0/12',
          '192.168.0.0/16',
          'fc00::/7',
        ]);
      case final value:
        expanded.add(value);
    }
  }
  return TrustedProxyConfig(expanded.map(_parseRule).toList());
}

TrustedProxyRule _parseRule(String input) {
  final parts = input.split('/');
  if (parts.length > 2) {
    throw ProxerError('Invalid trusted proxy value "$input"');
  }
  InternetAddress address;
  try {
    address = InternetAddress(parts.first);
  } on ArgumentError {
    throw ProxerError('Invalid trusted proxy value "$input"');
  }
  final bits = address.type == InternetAddressType.IPv4 ? 32 : 128;
  final prefix = parts.length == 2 ? int.tryParse(parts[1]) : bits;
  if (prefix == null || prefix < 0 || prefix > bits) {
    throw ProxerError('Invalid trusted proxy value "$input"');
  }
  final network = Uint8List.fromList(address.rawAddress);
  _maskInPlace(network, prefix);
  return TrustedProxyRule(network, prefix);
}

void _maskInPlace(Uint8List bytes, int prefix) {
  for (var index = 0; index < bytes.length; index += 1) {
    final remaining = prefix - index * 8;
    if (remaining >= 8) {
      continue;
    }
    if (remaining <= 0) {
      bytes[index] = 0;
    } else {
      bytes[index] &= (0xff << (8 - remaining)) & 0xff;
    }
  }
}

bool isTrustedProxy(String? remoteAddress, TrustedProxyConfig config) {
  if (remoteAddress == null) {
    return false;
  }
  InternetAddress address;
  try {
    address = InternetAddress(remoteAddress);
  } on ArgumentError {
    return false;
  }
  var bytes = Uint8List.fromList(address.rawAddress);
  if (bytes.length == 16 &&
      bytes.take(10).every((value) => value == 0) &&
      bytes[10] == 0xff &&
      bytes[11] == 0xff) {
    bytes = Uint8List.fromList(bytes.sublist(12));
  }
  for (final rule in config.rules) {
    if (rule.network.length != bytes.length) {
      continue;
    }
    final candidate = Uint8List.fromList(bytes);
    _maskInPlace(candidate, rule.prefixLength);
    var equal = true;
    for (var index = 0; index < candidate.length; index += 1) {
      equal = equal && candidate[index] == rule.network[index];
    }
    if (equal) {
      return true;
    }
  }
  return false;
}
