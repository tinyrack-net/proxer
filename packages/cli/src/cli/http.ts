import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { preferFlag, readEnvString } from "#app/cli/env.ts";
import { runHttpClient } from "#app/cli/run.ts";
import {
  basicAuthPasswordFlag,
  basicAuthUsernameFlag,
  httpServerFlag,
  httpSubdomainFlag,
  parseHttpSubdomain,
  tokenFlag,
} from "#app/cli/shared-flags.ts";
import { DEFAULT_HTTP_SERVER_URL } from "#app/config/constants.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";
import { ProxerError } from "#app/lib/error.ts";

type HttpFlags = {
  readonly basicAuthPassword?: string;
  readonly basicAuthUsername?: string;
  readonly server?: string;
  readonly subdomain?: string;
  readonly token?: string;
};

type HttpRouteRequest =
  | { readonly type: "auto" }
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

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

const parseHttpRoute = (input: string | undefined): HttpRouteRequest => {
  if (input === undefined) {
    return { type: "auto" };
  }

  if (input.trim() === "@") {
    return { type: "root" };
  }

  return { type: "subdomain", subdomain: parseHttpSubdomain(input) };
};

export const buildHttpCommand = () => {
  return buildCommand<HttpFlags, [number], ProxerCommandContext>({
    docs: {
      brief: "Expose a local HTTP service through a tunnel.",
    },
    parameters: {
      flags: {
        basicAuthPassword: basicAuthPasswordFlag,
        basicAuthUsername: basicAuthUsernameFlag,
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
      const route = parseHttpRoute(preferFlag(flags.subdomain, envSubdomain));
      const basicAuthPassword = preferFlag(
        flags.basicAuthPassword,
        readEnvString({ env, name: "PROXER_BASIC_AUTH_PASSWORD" }),
      );
      const basicAuthUsername = preferFlag(
        flags.basicAuthUsername,
        readEnvString({ env, name: "PROXER_BASIC_AUTH_USERNAME" }),
      );
      if (basicAuthUsername && !basicAuthPassword) {
        throw new ProxerError(
          "basic auth password is required when username is set",
        );
      }

      await runHttpClient(
        {
          ...(basicAuthPassword
            ? {
                basicAuth: {
                  password: basicAuthPassword,
                  ...(basicAuthUsername ? { username: basicAuthUsername } : {}),
                },
              }
            : {}),
          localPort,
          route,
          serverUrl: resolveControlServerUrl({ server }),
          token,
        },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
