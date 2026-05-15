import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { runHttpClient } from "#app/cli/run.ts";
import {
  controlPathFlag,
  httpNameFlag,
  httpServerFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";
import { ProxerError } from "#app/lib/error.ts";

type HttpFlags = {
  readonly server: string;
  readonly controlPath?: string;
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
        controlPath: controlPathFlag,
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
    async func(flags, localPort) {
      if (!flags.name) {
        throw new ProxerError("--name is required");
      }

      await runHttpClient(
        {
          localPort,
          name: flags.name,
          serverUrl: resolveControlServerUrl({
            controlPath: flags.controlPath,
            server: flags.server,
          }),
          token: flags.token,
        },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
