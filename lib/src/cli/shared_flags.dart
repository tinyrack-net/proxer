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

final FlagBinding<String?, ApplicationContext> tokenFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'token',
      brief: 'Token required by the tunnel server.',
      parse: (context, input) => parseToken(input),
    );

final FlagBinding<String?, ApplicationContext> serverListenFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'listen',
      brief: 'Single HTTP/WebSocket listener address.',
      parse: stringParser,
      placeholder: 'host:port',
    );

final FlagBinding<String?, ApplicationContext> httpServerFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'server',
      brief: 'Tunnel server base URL.',
      parse: stringParser,
      placeholder: 'wss://host',
    );

final FlagBinding<String?, ApplicationContext> serverDomainFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'domain',
      brief: 'Public root domain used for root and subdomain routing.',
      parse: (context, input) => _lowercase(input),
      placeholder: 'example.com',
    );

String _lowercase(String input) => input.toLowerCase();

final FlagBinding<String?, ApplicationContext>
httpSubdomainFlag = ParsedFlag.optional<String, ApplicationContext>(
  name: 'subdomain',
  brief:
      'Subdomain for host routing; omit for random, or use @ for root when the server has --domain.',
  parse: (context, input) => parseSubdomainFlag(input),
  placeholder: 'subdomain',
);

final FlagBinding<String?, ApplicationContext> basicAuthPasswordFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'basicAuthPassword',
      brief: 'Basic Auth password required for public tunnel access.',
      parse: (context, input) => parseBasicAuthPassword(input),
      placeholder: 'password',
    );

final FlagBinding<String?, ApplicationContext> basicAuthUsernameFlag =
    ParsedFlag.optional<String, ApplicationContext>(
      name: 'basicAuthUsername',
      brief: 'Basic Auth username required for public tunnel access.',
      parse: (context, input) => parseBasicAuthUsername(input),
      placeholder: 'username',
    );

final FlagBinding<RouteMode?, ApplicationContext> routeModeFlag =
    ParsedFlag.optional<RouteMode, ApplicationContext>(
      name: 'mode',
      brief: 'Tunnel route sharing mode: single or cluster.',
      parse: (context, input) => parseRouteMode(input),
      placeholder: 'mode',
    );

final FlagBinding<List<String>, ApplicationContext> trustedProxyFlag =
    ParsedFlag.variadic<String, ApplicationContext>(
      name: 'trustedProxy',
      brief: 'Trusted reverse proxy IP, CIDR, or preset.',
      parse: stringParser,
      placeholder: 'proxy',
    );
