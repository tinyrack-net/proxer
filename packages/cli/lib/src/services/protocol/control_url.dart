import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/util/error.dart';

String resolveControlServerUrl(String server) {
  final trimmed = server.trim();
  Uri uri;
  try {
    uri = Uri.parse(trimmed);
  } on FormatException {
    throw ProxerError(
      'server must be a valid ws://, wss://, http://, or https:// URL',
    );
  }
  final scheme = switch (uri.scheme) {
    'http' => 'ws',
    'https' => 'wss',
    'ws' || 'wss' => uri.scheme,
    _ => throw ProxerError(
      'server must use ws://, wss://, http://, or https://',
    ),
  };
  if (!uri.hasAuthority || uri.host.isEmpty) {
    throw ProxerError('server must include a host');
  }
  if (uri.path.isNotEmpty && uri.path != '/') {
    throw ProxerError('server URL must not include a path');
  }
  return uri
      .replace(scheme: scheme, path: controlPath, query: null, fragment: null)
      .toString();
}
