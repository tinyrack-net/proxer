import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/command_logger.dart';
import 'package:proxer/src/cli/env.dart';
import 'package:proxer/src/cli/run.dart';
import 'package:proxer/src/cli/shared_flags.dart';
import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/services/server.dart';
import 'package:proxer/src/util/address.dart';

final Command<ApplicationContext> serverCommand = buildCommand(
  docs: const CommandDocs(
    brief: 'Start a single-port public and tunnel control listener.',
  ),
  func: (context, flags, args) async {
    final logger = loggerFor(context);
    final trustedFlag = flags.trustedProxy;
    await runServer(
      ServerConfig(
        listenAddress: parseHostPort(
          preferFlag(flags.listen, readEnvString(context, 'PROXER_LISTEN')) ??
              defaultListenAddress,
        ),
        domain: preferFlag(
          flags.domain,
          readEnvString(context, 'PROXER_DOMAIN')?.toLowerCase(),
        ),
        token: preferFlag(flags.token, readEnvString(context, 'PROXER_TOKEN')),
        trustedProxies: trustedFlag.isNotEmpty
            ? trustedFlag
            : readEnvList(context, 'PROXER_TRUSTED_PROXIES') ?? [],
      ),
      info: logger.info,
      error: logger.error,
    );
  },
  parameters: CommandParameters(
    flags: FlagSet.one(serverListenFlag)
        .and(serverDomainFlag)
        .and(tokenFlag)
        .and(trustedProxyFlag)
        .map(
          (v) => (
            listen: v.$1.$1.$1,
            domain: v.$1.$1.$2,
            token: v.$1.$2,
            trustedProxy: v.$2,
          ),
        ),
    positional: PositionalSet.none(),
  ),
);
