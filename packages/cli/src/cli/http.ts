import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import {
  httpNameFlag,
  httpServerFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { ProxerError } from "#app/lib/error.ts";

type HttpFlags = {
  readonly server: string;
  readonly name?: string;
  readonly token?: string;
};

const parseLocalPort = (input: string): number => {
  if (!/^\d+$/.test(input)) {
    throw new ProxerError("local port must be a number");
  }

  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxerError("local port must be between 1 and 65535");
  }

  return port;
};

export const buildHttpCommand = () => {
  return buildCommand<HttpFlags, [number], ProxerCommandContext>({
    docs: {
      brief: "Expose a local HTTP service through a tunnel.",
    },
    parameters: {
      flags: {
        server: httpServerFlag,
        name: httpNameFlag,
        token: tokenFlag,
      },
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: parseLocalPort,
            brief: "Local HTTP port to expose.",
            placeholder: "port",
          },
        ],
      },
    },
    func(flags, localPort) {
      if (!flags.name) {
        throw new ProxerError("--name is required");
      }

      this.logger.info("http tunnel configuration");
      this.logger.info(`local: 127.0.0.1:${localPort}`);
      this.logger.info(`server: ${flags.server}`);
      this.logger.info(`name: ${flags.name}`);
      if (flags.token) {
        this.logger.info("token: configured");
      }
    },
  });
};
