import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/command_logger.dart';
import 'package:proxer/src/services/skill_install.dart';

final Command<ApplicationContext> skillInstallCommand = buildCommand(
  docs: const CommandDocs(
    brief: 'Install the Proxer skill markdown file for AI agents.',
  ),
  func: (context, flags, args) async {
    final logger = loggerFor(context);
    final result = await installProxerSkill(
      directory: args,
      dryRun: flags.dryRun ?? false,
      force: flags.force ?? false,
    );
    logger.info(
      result.dryRun
          ? 'would install skill: ${result.targetPath}'
          : 'installed skill: ${result.targetPath}',
    );
  },
  parameters: CommandParameters(
    flags:
        FlagSet.one(
              BooleanFlag.optional<ApplicationContext>(
                name: 'dryRun',
                brief: 'Print the target path without writing files.',
              ),
            )
            .and(
              BooleanFlag.optional<ApplicationContext>(
                name: 'force',
                brief: 'Overwrite an existing Proxer skill file.',
              ),
            )
            .map((v) => (dryRun: v.$1, force: v.$2)),
    positional: PositionalSet.one(
      Positional.required<String, ApplicationContext>(
        brief: 'Directory where proxer.md should be installed.',
        parse: stringParser,
        placeholder: 'directory',
      ),
    ),
  ),
);

final RouteMap<ApplicationContext> skillRoute = buildRouteMap(
  docs: const RouteMapDocs(
    brief: 'Install Proxer support files for AI agents.',
  ),
  routes: {'install': skillInstallCommand},
);
