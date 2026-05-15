import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { runServer as runServerRuntime } from "#app/cli/run.ts";
import {
  serverControlFlag,
  serverPublicFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { parseHostPort } from "#app/lib/address.ts";

type ServerFlags = {
  readonly public: string;
  readonly control: string;
  readonly token?: string;
};

export const buildServerCommand = () => {
  return buildCommand<ServerFlags, [], ProxerCommandContext>({
    docs: {
      brief: "Start public HTTP and tunnel control listeners.",
    },
    parameters: {
      flags: {
        public: serverPublicFlag,
        control: serverControlFlag,
        token: tokenFlag,
      },
    },
    async func(flags) {
      const publicAddress = parseHostPort(flags.public);
      const controlAddress = parseHostPort(flags.control);

      await runServerRuntime(
        { controlAddress, publicAddress, token: flags.token },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
