import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/command_logger.dart';
import 'package:proxer/src/services/skill_install.dart';

final Command skillInstallCommand = buildCommand(
  docs: const CommandDocs(
    brief: 'Install the Proxer skill markdown file for AI agents.',
  ),
  func: (context, flags, positional) async {
    final logger = loggerFor(context);
    final result = await installProxerSkill(
      directory: positional.first as String,
      dryRun: flags['dryRun'] as bool? ?? false,
      force: flags['force'] as bool? ?? false,
    );
    logger.info(
      result.dryRun
          ? 'would install skill: ${result.targetPath}'
          : 'installed skill: ${result.targetPath}',
    );
    return null;
  },
  parameters: const CommandParameters(
    flags: {
      'dryRun': BooleanFlag(
        brief: 'Print the target path without writing files.',
        optional: true,
      ),
      'force': BooleanFlag(
        brief: 'Overwrite an existing Proxer skill file.',
        optional: true,
      ),
    },
    positional: TuplePositionalParameters([
      PositionalParameter(
        brief: 'Directory where proxer.md should be installed.',
        parse: stringParser,
        placeholder: 'directory',
      ),
    ]),
  ),
);

final RouteMap skillRoute = buildRouteMap(
  docs: const RouteMapDocs(
    brief: 'Install Proxer support files for AI agents.',
  ),
  routes: {'install': skillInstallCommand},
);
