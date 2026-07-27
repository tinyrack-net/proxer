import 'package:proxer/src/util/error.dart';

class HostPort {
  const HostPort(this.host, this.port);

  final String host;
  final int port;
}

HostPort parseHostPort(String input) {
  final value = input.trim();
  String host;
  String portText;

  if (value.startsWith('[')) {
    final end = value.indexOf(']');
    if (end < 0 || end + 1 >= value.length || value[end + 1] != ':') {
      throw ProxerError('address must be in host:port format');
    }
    host = value.substring(1, end);
    portText = value.substring(end + 2);
  } else {
    final separator = value.lastIndexOf(':');
    if (separator <= 0) {
      throw ProxerError('address must be in host:port format');
    }
    host = value.substring(0, separator);
    portText = value.substring(separator + 1);
  }

  final port = int.tryParse(portText);
  if (host.isEmpty || port == null || port < 0 || port > 65535) {
    throw ProxerError('address must be in host:port format');
  }
  return HostPort(host, port);
}

String formatHostPort(HostPort address) {
  final host = address.host.contains(':') ? '[${address.host}]' : address.host;
  return '$host:${address.port}';
}
