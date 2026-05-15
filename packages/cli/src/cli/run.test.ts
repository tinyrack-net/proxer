import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { HostPort } from "#app/lib/address.ts";
import type { TerminalLogger } from "#app/services/terminal/logger.ts";
import { type RuntimeSignalTarget, runHttpClient, runServer } from "./run.ts";

const createLogger = (): TerminalLogger & { readonly messages: string[] } => {
  const messages: string[] = [];

  return {
    messages,
    info(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
};

const createSignalTarget = (): EventEmitter & RuntimeSignalTarget => {
  return new EventEmitter() as EventEmitter & RuntimeSignalTarget;
};

describe("runtime assembly", () => {
  it("starts the server, logs listener URLs, and closes on SIGINT", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const closed: string[] = [];
    let observedConfig:
      | {
          readonly publicAddress: HostPort;
          readonly controlAddress: HostPort;
          readonly token?: string;
        }
      | undefined;

    const runPromise = runServer(
      {
        controlAddress: { host: "127.0.0.1", port: 7000 },
        publicAddress: { host: "127.0.0.1", port: 8080 },
        token: "dev-token",
      },
      {
        logger,
        process,
        async startServer(config) {
          observedConfig = config;
          return {
            controlUrl: "ws://127.0.0.1:7000",
            publicUrl: "http://127.0.0.1:8080",
            async close() {
              closed.push("server");
            },
          };
        },
      },
    );

    await Promise.resolve();

    expect(observedConfig).toEqual({
      controlAddress: { host: "127.0.0.1", port: 7000 },
      publicAddress: { host: "127.0.0.1", port: 8080 },
      token: "dev-token",
    });
    expect(logger.messages).toContain("public: http://127.0.0.1:8080");
    expect(logger.messages).toContain("control: ws://127.0.0.1:7000");

    process.emit("SIGINT");
    await runPromise;

    expect(closed).toEqual(["server"]);
    expect(logger.messages).toContain("server stopped");
  });

  it("starts the HTTP tunnel client, logs forwarding details, and closes on SIGTERM", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const closed: string[] = [];
    let observedConfig:
      | {
          readonly localPort: number;
          readonly serverUrl: string;
          readonly name: string;
          readonly token?: string;
        }
      | undefined;

    const runPromise = runHttpClient(
      {
        localPort: 3000,
        name: "demo",
        serverUrl: "ws://127.0.0.1:7000",
        token: "dev-token",
      },
      {
        logger,
        process,
        async startHttpTunnelClient(config) {
          observedConfig = config;
          return {
            name: config.name,
            async close() {
              closed.push("client");
            },
          };
        },
      },
    );

    await Promise.resolve();

    expect(observedConfig).toEqual({
      localPort: 3000,
      name: "demo",
      serverUrl: "ws://127.0.0.1:7000",
      token: "dev-token",
    });
    expect(logger.messages).toContain("name: demo");
    expect(logger.messages).toContain("local: 127.0.0.1:3000");
    expect(logger.messages).toContain("server: ws://127.0.0.1:7000");

    process.emit("SIGTERM");
    await runPromise;

    expect(closed).toEqual(["client"]);
    expect(logger.messages).toContain("http tunnel stopped");
  });
});
