import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/command_logger.dart';
import 'package:proxer/src/cli/env.dart';
import 'package:proxer/src/cli/run.dart';
import 'package:proxer/src/cli/shared_flags.dart';
import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/services/server.dart';
import 'package:proxer/src/util/address.dart';

final Command serverCommand = buildCommand(
  docs: const CommandDocs(
    brief: 'Start a single-port public and tunnel control listener.',
  ),
  func: (context, flags, positional) async {
    final logger = loggerFor(context);
    final trustedFlag = (flags['trustedProxy'] as List?)?.cast<String>() ?? [];
    await runServer(
      ServerConfig(
        listenAddress: parseHostPort(
          preferFlag(
                flags['listen'] as String?,
                readEnvString(context, 'PROXER_LISTEN'),
              ) ??
              defaultListenAddress,
        ),
        domain: preferFlag(
          flags['domain'] as String?,
          readEnvString(context, 'PROXER_DOMAIN')?.toLowerCase(),
        ),
        token: preferFlag(
          flags['token'] as String?,
          readEnvString(context, 'PROXER_TOKEN'),
        ),
        trustedProxies: trustedFlag.isNotEmpty
            ? trustedFlag
            : readEnvList(context, 'PROXER_TRUSTED_PROXIES') ?? [],
      ),
      info: logger.info,
      error: logger.error,
    );
    return null;
  },
  parameters: const CommandParameters(
    flags: {
      'listen': serverListenFlag,
      'domain': serverDomainFlag,
      'token': tokenFlag,
      'trustedProxy': trustedProxyFlag,
    },
  ),
);
