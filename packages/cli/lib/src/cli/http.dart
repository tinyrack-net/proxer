import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/command_logger.dart';
import 'package:proxer/src/cli/env.dart';
import 'package:proxer/src/cli/run.dart';
import 'package:proxer/src/cli/shared_flags.dart';
import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/services/http_client.dart';
import 'package:proxer/src/services/protocol/control_url.dart';
import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/subdomain.dart';
import 'package:proxer/src/util/error.dart';

int parseLocalPort(String input) {
  if (!RegExp(r'^\d+$').hasMatch(input)) {
    throw ProxerError('local port must be a number');
  }
  final port = int.parse(input);
  if (port < 1 || port > 65535) {
    throw ProxerError('local port must be between 1 and 65535');
  }
  return port;
}

HttpClientRouteRequest parseHttpRoute(String? input) {
  if (input == null) {
    return const AutoRouteRequest();
  }
  if (input.trim() == '@') {
    return const RootRouteRequest();
  }
  return SubdomainRouteRequest(parseHttpSubdomain(input));
}

final Command httpCommand = buildCommand(
  docs: const CommandDocs(
    brief: 'Expose a local HTTP service through a tunnel.',
  ),
  func: (context, flags, positional) async {
    final logger = loggerFor(context);
    final token = preferFlag(
      flags['token'] as String?,
      readEnvString(context, 'PROXER_TOKEN'),
    );
    if (token == null || token.isEmpty) {
      throw ProxerError('token is required');
    }
    final password = preferFlag(
      flags['basicAuthPassword'] as String?,
      readEnvString(context, 'PROXER_BASIC_AUTH_PASSWORD'),
    );
    final username = preferFlag(
      flags['basicAuthUsername'] as String?,
      readEnvString(context, 'PROXER_BASIC_AUTH_USERNAME'),
    );
    if (username != null && password == null) {
      throw ProxerError('basic auth password is required when username is set');
    }
    final environmentMode = readEnvString(context, 'PROXER_MODE');
    final mode = preferFlag<RouteMode>(
      flags['mode'] as RouteMode?,
      environmentMode == null ? null : parseRouteMode(environmentMode),
    );
    final server =
        preferFlag(
          flags['server'] as String?,
          readEnvString(context, 'PROXER_SERVER'),
        ) ??
        defaultHttpServerUrl;
    await runHttpClient(
      HttpClientConfig(
        localPort: positional.first as int,
        serverUrl: resolveControlServerUrl(server),
        token: token,
        mode: mode ?? RouteMode.single,
        route: parseHttpRoute(
          preferFlag(
            flags['subdomain'] as String?,
            readEnvString(context, 'PROXER_SUBDOMAIN'),
          ),
        ),
        basicAuth: password == null
            ? null
            : BasicAuthConfig(password: password, username: username),
      ),
      info: logger.info,
      error: logger.error,
    );
    return null;
  },
  parameters: const CommandParameters(
    flags: {
      'basicAuthPassword': basicAuthPasswordFlag,
      'basicAuthUsername': basicAuthUsernameFlag,
      'mode': routeModeFlag,
      'server': httpServerFlag,
      'subdomain': httpSubdomainFlag,
      'token': tokenFlag,
    },
    positional: TuplePositionalParameters([
      PositionalParameter(
        brief: 'Local HTTP port to expose.',
        parse: parseLocalPort,
        placeholder: 'port',
      ),
    ]),
  ),
);
