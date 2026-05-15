import {
  type Application,
  buildApplication,
  type CommandContext,
  run,
  type StricliProcess,
  text_en,
} from "@stricli/core";
import { buildRootRoute } from "#app/cli/index.ts";
import { APP_NAME, APP_VERSION } from "#app/config/constants.ts";
import { formatProxerError, ProxerError } from "#app/lib/error.ts";
import {
  createTerminalLogger,
  type TerminalLogger,
} from "#app/services/terminal/logger.ts";

export type ProxerCommandContext = CommandContext & {
  readonly logger: TerminalLogger;
};

export type RunCliOptions = StricliProcess;

export const buildProxerApplication = (): Application<ProxerCommandContext> => {
  return buildApplication(buildRootRoute(), {
    name: APP_NAME,
    versionInfo: {
      currentVersion: `${APP_NAME} ${APP_VERSION}`,
    },
    scanner: {
      caseStyle: "allow-kebab-for-camel",
    },
    documentation: {
      disableAnsiColor: true,
    },
    localization: {
      text: {
        ...text_en,
        commandErrorResult(error) {
          return formatProxerError(error);
        },
        exceptionWhileRunningCommand(error) {
          return formatProxerError(error);
        },
      },
    },
    determineExitCode(error) {
      return error instanceof ProxerError ? error.exitCode : 1;
    },
  });
};

export const runCli = async (
  args: readonly string[],
  process: RunCliOptions = globalThis.process,
): Promise<void> => {
  await run(buildProxerApplication(), args, {
    process,
    forCommand() {
      return {
        process,
        logger: createTerminalLogger(process.stdout, process.stderr),
      };
    },
  });
};
