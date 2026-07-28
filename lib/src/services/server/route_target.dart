sealed class TunnelRoute {
  const TunnelRoute();

  String get key;
}

class RootTunnelRoute extends TunnelRoute {
  const RootTunnelRoute();

  @override
  String get key => 'root';
}

class SubdomainTunnelRoute extends TunnelRoute {
  const SubdomainTunnelRoute(this.subdomain);

  final String subdomain;

  @override
  String get key => 'subdomain:$subdomain';
}

TunnelRoute? parseTunnelRouteFromHost(String? host, String? domain) {
  final authority = host?.trim().toLowerCase();
  if (authority == null ||
      authority.isEmpty ||
      authority.startsWith('[') ||
      authority.contains(']')) {
    return null;
  }
  final parts = authority.split(':');
  if (parts.length > 2 || parts.length == 2 && int.tryParse(parts[1]) == null) {
    return null;
  }
  final hostname = parts.first;
  if (hostname.isEmpty) {
    return null;
  }
  if (domain == null) {
    final label = hostname.split('.').first;
    return label.isEmpty ? null : SubdomainTunnelRoute(label);
  }
  final normalizedDomain = domain.toLowerCase();
  if (hostname == normalizedDomain) {
    return const RootTunnelRoute();
  }
  final suffix = '.$normalizedDomain';
  if (!hostname.endsWith(suffix)) {
    return null;
  }
  final prefix = hostname.substring(0, hostname.length - suffix.length);
  return prefix.isEmpty || prefix.contains('.')
      ? null
      : SubdomainTunnelRoute(prefix);
}
