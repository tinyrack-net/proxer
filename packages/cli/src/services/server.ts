import type { HostPort } from "#app/lib/address.ts";
import { startControlServer } from "#app/server/control-server.ts";
import { startPublicHttpServer } from "#app/server/public-http-server.ts";
import { TunnelRegistry } from "#app/server/stream-registry.ts";

export type ServerConfig = {
  readonly publicAddress: HostPort;
  readonly controlAddress: HostPort;
  readonly token?: string;
};

export type RunningServer = {
  readonly publicUrl: string;
  readonly controlUrl: string;
  close(): Promise<void>;
};

export const startServer = async ({
  controlAddress,
  publicAddress,
  token,
}: ServerConfig): Promise<RunningServer> => {
  const registry = new TunnelRegistry();
  const publicServer = await startPublicHttpServer({
    address: publicAddress,
    registry,
  });

  try {
    const controlServer = await startControlServer({
      address: controlAddress,
      registry,
      token,
    });

    return {
      controlUrl: controlServer.url,
      publicUrl: publicServer.url,
      async close() {
        await controlServer.close();
        await publicServer.close();
      },
    };
  } catch (error) {
    await publicServer.close();
    throw error;
  }
};
