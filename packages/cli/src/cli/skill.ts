import { buildCommand, buildRouteMap } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { installProxerSkill } from "#app/services/skill-installer.ts";

type SkillInstallFlags = {
  readonly dryRun?: boolean;
  readonly force?: boolean;
};

const buildSkillInstallCommand = () => {
  return buildCommand<SkillInstallFlags, [string], ProxerCommandContext>({
    docs: {
      brief: "Install the Proxer skill markdown file for AI agents.",
    },
    parameters: {
      flags: {
        dryRun: {
          kind: "boolean",
          brief: "Print the target path without writing files.",
          optional: true,
        },
        force: {
          kind: "boolean",
          brief: "Overwrite an existing Proxer skill file.",
          optional: true,
        },
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: (input: string) => input,
            brief: "Directory where proxer.md should be installed.",
            placeholder: "directory",
          },
        ],
      },
    },
    async func(flags, directory) {
      const result = await installProxerSkill({
        directory,
        dryRun: flags.dryRun,
        force: flags.force,
      });

      if (result.dryRun) {
        this.logger.info(`would install skill: ${result.targetPath}`);
        return;
      }

      this.logger.info(`installed skill: ${result.targetPath}`);
    },
  });
};

const skillCommands = {
  install: buildSkillInstallCommand(),
};

export const buildSkillCommand = () => {
  return buildRouteMap<keyof typeof skillCommands, ProxerCommandContext>({
    routes: skillCommands,
    docs: {
      brief: "Install Proxer support files for AI agents.",
    },
  });
};
