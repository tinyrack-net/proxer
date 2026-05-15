import { buildCommand } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { preferFlag, readEnvList, readEnvString } from "#app/cli/env.ts";
import { runServer as runServerRuntime } from "#app/cli/run.ts";
import {
  controlPathFlag,
  serverDomainFlag,
  serverListenFlag,
  tokenFlag,
  trustedProxyFlag,
} from "#app/cli/shared-flags.ts";
import { DEFAULT_LISTEN_ADDRESS } from "#app/config/constants.ts";
import { parseHostPort } from "#app/lib/address.ts";
import { normalizeControlPath } from "#app/lib/control-path.ts";

type ServerFlags = {
  readonly listen?: string;
  readonly controlPath?: string;
  readonly domain?: string;
  readonly token?: string;
  readonly trustedProxy?: readonly string[];
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
        domain: serverDomainFlag,
        token: tokenFlag,
        trustedProxy: trustedProxyFlag,
      },
    },
    async func(flags) {
      const env = this.env ?? {};
      const listen =
        preferFlag(
          flags.listen,
          readEnvString({ env, name: "PROXER_LISTEN" }),
        ) ?? DEFAULT_LISTEN_ADDRESS;
      const controlPath = normalizeControlPath(
        preferFlag(
          flags.controlPath,
          readEnvString({ env, name: "PROXER_CONTROL_PATH" }),
        ),
      );
      const trustedProxyFlags = flags.trustedProxy ?? [];
      const trustedProxies =
        trustedProxyFlags.length > 0
          ? trustedProxyFlags
          : readEnvList({ env, name: "PROXER_TRUSTED_PROXIES" });

      await runServerRuntime(
        {
          controlPath,
          domain: preferFlag(
            flags.domain,
            readEnvString({ env, name: "PROXER_DOMAIN" })?.toLowerCase(),
          ),
          listenAddress: parseHostPort(listen),
          token: preferFlag(
            flags.token,
            readEnvString({ env, name: "PROXER_TOKEN" }),
          ),
          trustedProxies,
        },
        { logger: this.logger, process: this.process },
      );
    },
  });
};
