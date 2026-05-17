import type {
  HttpClientConfig,
  RunningTunnelClient,
} from "#app/services/http-client.ts";
import { startHttpTunnelClient as startHttpTunnelClientService } from "#app/services/http-client.ts";
import type { ServerConfig } from "#app/services/server.ts";
import { startServer as startServerService } from "#app/services/server.ts";
import type { TerminalLogger } from "#app/services/terminal/logger.ts";

export type RuntimeSignal = "SIGINT" | "SIGTERM";

export type RuntimeSignalTarget = {
  once(signal: RuntimeSignal, listener: () => void): unknown;
  off?(signal: RuntimeSignal, listener: () => void): unknown;
  removeListener?(signal: RuntimeSignal, listener: () => void): unknown;
};

type RunningServer = Awaited<ReturnType<typeof startServerService>>;

export type RunServerOptions = {
  readonly logger: TerminalLogger;
  readonly process?: unknown;
  readonly startServer?: (config: ServerConfig) => Promise<RunningServer>;
};

export type RunHttpClientOptions = {
  readonly logger: TerminalLogger;
  readonly process?: unknown;
  readonly startHttpTunnelClient?: (
    config: HttpClientConfig,
  ) => Promise<RunningTunnelClient>;
};

const isRuntimeSignalTarget = (
  value: unknown,
): value is RuntimeSignalTarget => {
  return (
    typeof value === "object" &&
    value !== null &&
    "once" in value &&
    typeof value.once === "function"
  );
};

export const waitForShutdownSignal = async (
  signalTarget: unknown = globalThis.process,
): Promise<RuntimeSignal> => {
  if (!isRuntimeSignalTarget(signalTarget)) {
    return "SIGTERM";
  }

  return await new Promise<RuntimeSignal>((resolve) => {
    const cleanup = (): void => {
      signalTarget.off?.("SIGINT", onSigint);
      signalTarget.off?.("SIGTERM", onSigterm);
      signalTarget.removeListener?.("SIGINT", onSigint);
      signalTarget.removeListener?.("SIGTERM", onSigterm);
    };
    const resolveSignal = (signal: RuntimeSignal): void => {
      cleanup();
      resolve(signal);
    };
    const onSigint = (): void => resolveSignal("SIGINT");
    const onSigterm = (): void => resolveSignal("SIGTERM");

    signalTarget.once("SIGINT", onSigint);
    signalTarget.once("SIGTERM", onSigterm);
  });
};

export const runServer = async (
  config: ServerConfig,
  { logger, process, startServer = startServerService }: RunServerOptions,
): Promise<void> => {
  const server = await startServer(config);

  try {
    logger.info(`public: ${server.publicUrl}`);
    logger.info(`control: ${server.controlUrl}`);
    if (config.token === undefined) {
      logger.info(`token: ${server.token}`);
    }
    await waitForShutdownSignal(process);
  } finally {
    await server.close();
    logger.info("server stopped");
  }
};

export const runHttpClient = async (
  config: HttpClientConfig,
  {
    logger,
    process,
    startHttpTunnelClient = startHttpTunnelClientService,
  }: RunHttpClientOptions,
): Promise<void> => {
  const client = await startHttpTunnelClient(config);

  try {
    if (client.subdomain) {
      logger.info(`subdomain: ${client.subdomain}`);
    } else {
      logger.info("route: root domain");
    }
    logger.info(`local: 127.0.0.1:${config.localPort}`);
    logger.info(`server: ${config.serverUrl}`);
    await waitForShutdownSignal(process);
  } finally {
    await client.close();
    logger.info("http tunnel stopped");
  }
};
