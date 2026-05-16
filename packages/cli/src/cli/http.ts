import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { preferFlag, readEnvString } from "#app/cli/env.ts";
import { runHttpClient } from "#app/cli/run.ts";
import {
  httpServerFlag,
  httpSubdomainFlag,
  parseHttpSubdomain,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { DEFAULT_HTTP_SERVER_URL } from "#app/config/constants.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";
import { ProxerError } from "#app/lib/error.ts";

type HttpFlags = {
  readonly server?: string;
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
      const token = preferFlag(
        flags.token,
        readEnvString({ env, name: "PROXER_TOKEN" }),
      );
      if (!token) {
        throw new ProxerError("token is required");
      }

      const server =
        preferFlag(
          flags.server,
          readEnvString({ env, name: "PROXER_SERVER" }),
        ) ?? DEFAULT_HTTP_SERVER_URL;
      const envSubdomain = readEnvString({ env, name: "PROXER_SUBDOMAIN" });

      await runHttpClient(
        {
          localPort,
          serverUrl: resolveControlServerUrl({ server }),
          subdomain: preferFlag(
            flags.subdomain,
            envSubdomain ? parseHttpSubdomain(envSubdomain) : undefined,
          ),
          token,
        },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
