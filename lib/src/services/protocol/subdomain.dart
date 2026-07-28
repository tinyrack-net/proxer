import 'package:proxer/src/util/error.dart';

const String subdomainRuleMessage =
    'subdomain must be a DNS label: lowercase letters, numbers, and hyphens only; no leading or trailing hyphen; max 63 characters';

final RegExp _subdomainPattern = RegExp(
  r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$',
);

String normalizeTunnelSubdomain(String input) => input.toLowerCase();

bool isTunnelSubdomain(Object? value) {
  return value is String && _subdomainPattern.hasMatch(value);
}

String parseHttpSubdomain(String input) {
  final subdomain = normalizeTunnelSubdomain(input);
  if (!isTunnelSubdomain(subdomain)) {
    throw ProxerError(subdomainRuleMessage);
  }
  return subdomain;
}
