class LogRoute {
  const LogRoute.root() : subdomain = null;
  const LogRoute.subdomain(this.subdomain);

  final String? subdomain;
}

String sanitizeLogPath(String value) {
  final uri = Uri.tryParse(value);
  return uri?.path.isNotEmpty == true ? uri!.path : '/';
}

String sanitizeLogUrl(String value) {
  final uri = Uri.tryParse(value);
  if (uri == null) {
    return value;
  }
  return uri.replace(userInfo: '', query: null, fragment: null).toString();
}

String derivePublicUrl({required String serverUrl, String? subdomain}) {
  final uri = Uri.parse(serverUrl);
  final scheme = uri.scheme == 'wss' || uri.scheme == 'https'
      ? 'https'
      : 'http';
  final host = subdomain == null ? uri.host : '$subdomain.${uri.host}';
  return uri
      .replace(scheme: scheme, host: host, path: '', query: null)
      .toString();
}

String formatRoutePrefix(LogRoute? route) {
  if (route == null) {
    return '';
  }
  return route.subdomain == null ? '[root]' : '[${route.subdomain}]';
}
