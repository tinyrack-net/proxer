import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { preferFlag, readEnvString } from "#app/cli/env.ts";
import { runHttpClient } from "#app/cli/run.ts";
import {
  controlPathFlag,
  httpServerFlag,
  httpSubdomainFlag,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { DEFAULT_HTTP_SERVER_URL } from "#app/config/constants.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";
import { ProxerError } from "#app/lib/error.ts";

type HttpFlags = {
  readonly server?: string;
  readonly controlPath?: string;
  readonly subdomain?: string;
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
        subdomain: httpSubdomainFlag,
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
      const env = this.env ?? {};
      const controlPath = preferFlag(
        flags.controlPath,
        readEnvString({ env, name: "PROXER_CONTROL_PATH" }),
      );
      const server =
        preferFlag(
          flags.server,
          readEnvString({ env, name: "PROXER_SERVER" }),
        ) ?? DEFAULT_HTTP_SERVER_URL;

      await runHttpClient(
        {
          localPort,
          serverUrl: resolveControlServerUrl({
            controlPath,
            server,
          }),
          subdomain: preferFlag(
            flags.subdomain,
            readEnvString({ env, name: "PROXER_SUBDOMAIN" })?.toLowerCase(),
          ),
          token: preferFlag(
            flags.token,
            readEnvString({ env, name: "PROXER_TOKEN" }),
          ),
        },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
