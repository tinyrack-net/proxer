import { randomBytes } from "node:crypto";
import type { HostPort } from "#app/lib/address.ts";
import { ProxerError } from "#app/lib/error.ts";
import type { RuntimeLogger } from "#app/lib/logging.ts";
import { startSinglePortServer } from "#app/server/single-port-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { parseTrustedProxyValues } from "#app/server/trusted-proxies.ts";

export type ServerConfig = {
  readonly listenAddress: HostPort;
  readonly domain?: string;
  readonly logger?: RuntimeLogger;
  readonly token?: string;
  readonly trustedProxies?: readonly string[];
};

export type RunningServer = {
  readonly publicUrl: string;
  readonly controlUrl: string;
  readonly token: string;
  close(): Promise<void>;
};

const generateToken = (): string => randomBytes(32).toString("base64url");

export const startServer = async ({
  domain,
  listenAddress,
  logger,
  token,
  trustedProxies,
}: ServerConfig): Promise<RunningServer> => {
  const serverToken = token?.trim() ?? generateToken();
  if (!serverToken) {
    throw new ProxerError("token must not be empty");
  }

  const registry = new TunnelRegistry();
  const server = await startSinglePortServer({
    domain,
    listenAddress,
    logger,
    registry,
    token: serverToken,
    trustedProxies: parseTrustedProxyValues(trustedProxies ?? []),
  });
  return { ...server, token: serverToken };
};
