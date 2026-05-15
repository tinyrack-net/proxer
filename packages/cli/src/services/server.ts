import type { HostPort } from "#app/lib/address.ts";
import { normalizeControlPath } from "#app/lib/control-path.ts";
import { startSinglePortServer } from "#app/server/single-port-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

export type ServerConfig = {
  readonly listenAddress: HostPort;
  readonly controlPath?: string;
  readonly domain?: string;
  readonly token?: string;
};

export type RunningServer = {
  readonly publicUrl: string;
  readonly controlUrl: string;
  close(): Promise<void>;
};

export const startServer = async ({
  controlPath,
  domain,
  listenAddress,
  token,
}: ServerConfig): Promise<RunningServer> => {
  const registry = new TunnelRegistry();
  return await startSinglePortServer({
    controlPath: normalizeControlPath(controlPath),
    domain,
    listenAddress,
    registry,
    token,
  });
};
