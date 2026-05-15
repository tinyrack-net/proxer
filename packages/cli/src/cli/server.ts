import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { runServer as runServerRuntime } from "#app/cli/run.ts";
import {
  controlPathFlag,
  serverListenFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { parseHostPort } from "#app/lib/address.ts";
import { normalizeControlPath } from "#app/lib/control-path.ts";

type ServerFlags = {
  readonly listen: string;
  readonly controlPath?: string;
  readonly token?: string;
};

export const buildServerCommand = () => {
  return buildCommand<ServerFlags, [], ProxerCommandContext>({
    docs: {
      brief: "Start a single-port public and tunnel control listener.",
    },
    parameters: {
      flags: {
        listen: serverListenFlag,
        controlPath: controlPathFlag,
        token: tokenFlag,
      },
    },
    async func(flags) {
      const listenAddress = parseHostPort(flags.listen);
      const controlPath = normalizeControlPath(flags.controlPath);

      await runServerRuntime(
        { controlPath, listenAddress, token: flags.token },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
