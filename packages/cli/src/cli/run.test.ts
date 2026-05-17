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
  it("starts the single-port server, logs listener URLs, and closes on SIGINT", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const closed: string[] = [];
    let observedConfig:
      | {
          readonly listenAddress: HostPort;
          readonly domain?: string;
          readonly token?: string;
        }
      | undefined;

    const runPromise = runServer(
      {
        domain: "proxy.example.com",
        listenAddress: { host: "127.0.0.1", port: 8080 },
        token: "dev-token",
      },
      {
        logger,
        process,
        async startServer(config) {
          observedConfig = config;
          return {
            controlUrl: "ws://127.0.0.1:8080/__proxer__/control",
            publicUrl: "http://127.0.0.1:8080",
            token: "dev-token",
            async close() {
              closed.push("server");
            },
          };
        },
      },
    );

    await Promise.resolve();

    expect(observedConfig).toEqual({
      domain: "proxy.example.com",
      listenAddress: { host: "127.0.0.1", port: 8080 },
      token: "dev-token",
    });
    expect(logger.messages).toContain("public: http://127.0.0.1:8080");
    expect(logger.messages).toContain(
      "control: ws://127.0.0.1:8080/__proxer__/control",
    );

    process.emit("SIGINT");
    await runPromise;

    expect(closed).toEqual(["server"]);
    expect(logger.messages).toContain("server stopped");
  });

  it("logs a generated server token when the server returns one", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const server = {
      controlUrl: "ws://127.0.0.1:8080/__proxer__/control",
      publicUrl: "http://127.0.0.1:8080",
      token: "generated-token",
      async close() {},
    };

    const runPromise = runServer(
      { listenAddress: { host: "127.0.0.1", port: 8080 } },
      {
        logger,
        process,
        async startServer() {
          return server;
        },
      },
    );

    await Promise.resolve();

    expect(logger.messages).toContain("token: generated-token");

    process.emit("SIGTERM");
    await runPromise;
  });

  it("does not log a manually supplied server token", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const closed: string[] = [];

    const runPromise = runServer(
      {
        listenAddress: { host: "127.0.0.1", port: 8080 },
        token: "manual-token",
      },
      {
        logger,
        process,
        async startServer() {
          return {
            controlUrl: "ws://127.0.0.1:8080/__proxer__/control",
            publicUrl: "http://127.0.0.1:8080",
            token: "manual-token",
            async close() {
              closed.push("server");
            },
          };
        },
      },
    );

    await Promise.resolve();

    expect(logger.messages).toContain("public: http://127.0.0.1:8080");
    expect(logger.messages).toContain(
      "control: ws://127.0.0.1:8080/__proxer__/control",
    );
    expect(logger.messages).not.toContain("token: manual-token");
    expect(
      logger.messages.some((message) => message.includes("manual-token")),
    ).toBe(false);

    process.emit("SIGTERM");
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
          readonly subdomain?: string;
          readonly token?: string;
        }
      | undefined;

    const runPromise = runHttpClient(
      {
        localPort: 3000,
        serverUrl: "ws://127.0.0.1:8080/__proxer__/control",
        subdomain: "demo",
        token: "dev-token",
      },
      {
        logger,
        process,
        async startHttpTunnelClient(config) {
          observedConfig = config;
          return {
            subdomain: config.subdomain,
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
      serverUrl: "ws://127.0.0.1:8080/__proxer__/control",
      subdomain: "demo",
      token: "dev-token",
    });
    expect(logger.messages).toContain("subdomain: demo");
    expect(logger.messages).toContain("local: 127.0.0.1:3000");
    expect(logger.messages).toContain(
      "server: ws://127.0.0.1:8080/__proxer__/control",
    );

    process.emit("SIGTERM");
    await runPromise;

    expect(closed).toEqual(["client"]);
    expect(logger.messages).toContain("http tunnel stopped");
  });

  it("logs root-domain routing for an HTTP tunnel without a subdomain", async () => {
    const logger = createLogger();
    const process = createSignalTarget();
    const runPromise = runHttpClient(
      {
        localPort: 3000,
        serverUrl: "ws://127.0.0.1:8080/__proxer__/control",
      },
      {
        logger,
        process,
        async startHttpTunnelClient(config) {
          return {
            subdomain: config.subdomain,
            async close() {},
          };
        },
      },
    );

    await Promise.resolve();

    expect(logger.messages).toContain("route: root domain");

    process.emit("SIGTERM");
    await runPromise;
  });
});
