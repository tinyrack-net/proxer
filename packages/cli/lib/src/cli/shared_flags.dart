import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/subdomain.dart';
import 'package:proxer/src/util/error.dart';

String parseToken(String input) {
  final token = input.trim();
  if (token.isEmpty) {
    throw ProxerError('token must not be empty');
  }
  return token;
}

String parseBasicAuthPassword(String input) {
  final value = input.trim();
  if (value.isEmpty) {
    throw ProxerError('basic auth password must not be empty');
  }
  return value;
}

String parseBasicAuthUsername(String input) {
  final value = input.trim();
  if (value.isEmpty) {
    throw ProxerError('basic auth username must not be empty');
  }
  return value;
}

RouteMode parseRouteMode(String input) {
  final mode = RouteMode.tryParse(input.trim());
  if (mode == null) {
    throw ProxerError('mode must be single or cluster');
  }
  return mode;
}

String parseSubdomainFlag(String input) {
  return input.trim() == '@' ? '@' : parseHttpSubdomain(input);
}

const ParsedFlag tokenFlag = ParsedFlag(
  brief: 'Token required by the tunnel server.',
  parse: parseToken,
  optional: true,
);

const ParsedFlag serverListenFlag = ParsedFlag(
  brief: 'Single HTTP/WebSocket listener address.',
  parse: stringParser,
  placeholder: 'host:port',
  optional: true,
);

const ParsedFlag httpServerFlag = ParsedFlag(
  brief: 'Tunnel server base URL.',
  parse: stringParser,
  placeholder: 'wss://host',
  optional: true,
);

const ParsedFlag serverDomainFlag = ParsedFlag(
  brief: 'Public root domain used for root and subdomain routing.',
  parse: _lowercase,
  placeholder: 'example.com',
  optional: true,
);

String _lowercase(String input) => input.toLowerCase();

const ParsedFlag httpSubdomainFlag = ParsedFlag(
  brief:
      'Subdomain for host routing; omit for random, or use @ for root when the server has --domain.',
  parse: parseSubdomainFlag,
  placeholder: 'subdomain',
  optional: true,
);

const ParsedFlag basicAuthPasswordFlag = ParsedFlag(
  brief: 'Basic Auth password required for public tunnel access.',
  parse: parseBasicAuthPassword,
  placeholder: 'password',
  optional: true,
);

const ParsedFlag basicAuthUsernameFlag = ParsedFlag(
  brief: 'Basic Auth username required for public tunnel access.',
  parse: parseBasicAuthUsername,
  placeholder: 'username',
  optional: true,
);

const ParsedFlag routeModeFlag = ParsedFlag(
  brief: 'Tunnel route sharing mode: single or cluster.',
  parse: parseRouteMode,
  placeholder: 'mode',
  optional: true,
);

const ParsedFlag trustedProxyFlag = ParsedFlag(
  brief: 'Trusted reverse proxy IP, CIDR, or preset.',
  parse: stringParser,
  placeholder: 'proxy',
  optional: true,
  variadic: true,
);
