import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import {
  serverControlFlag,
  serverPublicFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { formatHostPort, parseHostPort } from "#app/lib/address.ts";

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
    func(flags) {
      const publicAddress = parseHostPort(flags.public);
      const controlAddress = parseHostPort(flags.control);

      this.logger.info("server configuration");
      this.logger.info(`public: ${formatHostPort(publicAddress)}`);
      this.logger.info(`control: ${formatHostPort(controlAddress)}`);
      if (flags.token) {
        this.logger.info("token: configured");
      }
    },
  });
};
