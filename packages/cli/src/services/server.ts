import type { HostPort } from "#app/lib/address.ts";
import { startSinglePortServer } from "#app/server/single-port-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";
import { parseTrustedProxyValues } from "#app/server/trusted-proxies.ts";

export type ServerConfig = {
  readonly listenAddress: HostPort;
  readonly domain?: string;
  readonly token?: string;
  readonly trustedProxies?: readonly string[];
};

export type RunningServer = {
  readonly publicUrl: string;
  readonly controlUrl: string;
  close(): Promise<void>;
};

export const startServer = async ({
  domain,
  listenAddress,
  token,
  trustedProxies,
}: ServerConfig): Promise<RunningServer> => {
  const registry = new TunnelRegistry();
  return await startSinglePortServer({
    domain,
    listenAddress,
    registry,
    token,
    trustedProxies: parseTrustedProxyValues(trustedProxies ?? []),
  });
};
