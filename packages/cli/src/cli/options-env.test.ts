import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RunCliOptions, runCli } from "#app/application.ts";
import type { HttpClientConfig } from "#app/services/http-client.ts";
import type { ServerConfig } from "#app/services/server.ts";

const mocks = vi.hoisted(() => ({
  runHttpClient:
    vi.fn<(config: HttpClientConfig, options: unknown) => Promise<void>>(),
  runServer: vi.fn<(config: ServerConfig, options: unknown) => Promise<void>>(),
}));

vi.mock("#app/cli/run.ts", () => ({
  runHttpClient: mocks.runHttpClient,
  runServer: mocks.runServer,
}));

const createCapturedProcess = (
  env: Record<string, string | undefined> = {},
): EventEmitter &
  RunCliOptions & {
    result(): {
      readonly exitCode: number | undefined;
      readonly stderr: string;
      readonly stdout: string;
    };
  } => {
  const stderr = new PassThrough();
  const stdout = new PassThrough();
  const stderrChunks: Buffer[] = [];
  const stdoutChunks: Buffer[] = [];
  let exitCode: number | undefined;
  const process = new EventEmitter() as EventEmitter & RunCliOptions;

  stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));

  Object.defineProperties(process, {
    env: { value: env },
    exitCode: {
      get() {
        return exitCode;
      },
      set(value: number | undefined) {
        exitCode = value;
      },
    },
    stderr: { value: stderr },
    stdout: { value: stdout },
  });

  return Object.assign(process, {
    result() {
      return {
        exitCode,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      };
    },
  });
};

const firstServerConfig = (): ServerConfig => {
  return mocks.runServer.mock.calls[0]?.[0] as ServerConfig;
};

const firstHttpConfig = (): HttpClientConfig => {
  return mocks.runHttpClient.mock.calls[0]?.[0] as HttpClientConfig;
};

describe("CLI PROXER_ environment options", () => {
  beforeEach(() => {
    mocks.runHttpClient.mockResolvedValue(undefined);
    mocks.runHttpClient.mockClear();
    mocks.runServer.mockResolvedValue(undefined);
    mocks.runServer.mockClear();
  });

  it("uses server environment options when flags are omitted", async () => {
    await runCli(
      ["server"],
      createCapturedProcess({
        PROXER_DOMAIN: "Proxy.Example.Com",
        PROXER_LISTEN: "127.0.0.1:9090",
        PROXER_TOKEN: "secret",
        PROXER_CONTROL_PATH: "/control",
      }),
    );

    expect(firstServerConfig()).toMatchObject({
      domain: "proxy.example.com",
      listenAddress: { host: "127.0.0.1", port: 9090 },
      token: "secret",
    });
    expect(firstServerConfig()).not.toHaveProperty("controlPath");
  });

  it("prefers server flags over environment options", async () => {
    await runCli(
      [
        "server",
        "--listen",
        "127.0.0.1:8081",
        "--domain",
        "Flag.Example.Com",
        "--token",
        "flag-secret",
      ],
      createCapturedProcess({
        PROXER_CONTROL_PATH: "/env-control",
        PROXER_DOMAIN: "env.example.com",
        PROXER_LISTEN: "127.0.0.1:9090",
        PROXER_TOKEN: "env-secret",
      }),
    );

    expect(firstServerConfig()).toMatchObject({
      domain: "flag.example.com",
      listenAddress: { host: "127.0.0.1", port: 8081 },
      token: "flag-secret",
    });
    expect(firstServerConfig()).not.toHaveProperty("controlPath");
  });

  it("ignores empty server environment options and keeps defaults", async () => {
    await runCli(
      ["server"],
      createCapturedProcess({
        PROXER_CONTROL_PATH: "   ",
        PROXER_LISTEN: "",
      }),
    );

    expect(firstServerConfig()).toMatchObject({
      listenAddress: { host: "127.0.0.1", port: 8080 },
    });
    expect(firstServerConfig()).not.toHaveProperty("controlPath");
  });

  it("does not accept the removed server --control-path flag", async () => {
    await runCli(
      ["server", "--control-path", "/flag-control"],
      createCapturedProcess(),
    );

    expect(mocks.runServer).not.toHaveBeenCalled();
  });

  it("uses HTTP client environment options when flags are omitted", async () => {
    await runCli(
      ["http", "3000"],
      createCapturedProcess({
        PROXER_CONTROL_PATH: "/control",
        PROXER_SERVER: "https://proxy.example.com",
        PROXER_SUBDOMAIN: "Demo",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toEqual({
      localPort: 3000,
      serverUrl: "wss://proxy.example.com/__proxer__/control",
      subdomain: "demo",
      token: "secret",
    });
  });

  it("prefers HTTP client flags over environment options", async () => {
    await runCli(
      [
        "http",
        "3000",
        "--server",
        "https://flag.example.com",
        "--subdomain",
        "Flag",
        "--token",
        "flag-secret",
      ],
      createCapturedProcess({
        PROXER_CONTROL_PATH: "/env-control",
        PROXER_SERVER: "https://env.example.com",
        PROXER_SUBDOMAIN: "env",
        PROXER_TOKEN: "env-secret",
      }),
    );

    expect(firstHttpConfig()).toEqual({
      localPort: 3000,
      serverUrl: "wss://flag.example.com/__proxer__/control",
      subdomain: "flag",
      token: "flag-secret",
    });
  });

  it.each([
    ["dot", "bad.name", {}],
    ["underscore", "bad_name", {}],
    ["leading hyphen", undefined, { PROXER_SUBDOMAIN: "-bad" }],
    ["trailing hyphen", "bad-", {}],
    ["longer than 63 characters", "a".repeat(64), {}],
  ])("rejects an HTTP subdomain with a %s", async (_case, subdomain, env) => {
    const process = createCapturedProcess(env);
    const args = subdomain
      ? ["http", "3000", "--subdomain", subdomain]
      : ["http", "3000"];

    await runCli(args, process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stdout).toBe("");
    expect(process.result().stderr).toContain("subdomain must be a DNS label");
  });

  it("accepts a mixed-case HTTP subdomain flag and normalizes it", async () => {
    await runCli(
      [
        "http",
        "3000",
        "--server",
        "https://proxy.example.com",
        "--subdomain",
        "Mixed-Case",
      ],
      createCapturedProcess(),
    );

    expect(firstHttpConfig()).toMatchObject({ subdomain: "mixed-case" });
  });

  it("does not accept the removed HTTP --control-path flag", async () => {
    await runCli(
      ["http", "3000", "--control-path", "/flag-control"],
      createCapturedProcess(),
    );

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
  });

  it("keeps local HTTP port positional even when environment is present", async () => {
    await runCli([], createCapturedProcess({ PROXER_LOCAL_PORT: "3000" }));

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
  });

  it("passes repeated trusted proxy CLI values", async () => {
    await runCli(
      ["server", "--trusted-proxy", "loopback", "--trusted-proxy", "private"],
      createCapturedProcess(),
    );

    expect(firstServerConfig()).toMatchObject({
      trustedProxies: ["loopback", "private"],
    });
  });

  it("uses PROXER_TRUSTED_PROXIES as a comma-separated list", async () => {
    await runCli(
      ["server"],
      createCapturedProcess({
        PROXER_TRUSTED_PROXIES: "loopback, private, 10.42.0.0/16",
      }),
    );

    expect(firstServerConfig()).toMatchObject({
      trustedProxies: ["loopback", "private", "10.42.0.0/16"],
    });
  });

  it("prefers trusted proxy CLI values over the environment list", async () => {
    await runCli(
      ["server", "--trusted-proxy", "loopback"],
      createCapturedProcess({ PROXER_TRUSTED_PROXIES: "private" }),
    );

    expect(firstServerConfig()).toMatchObject({
      trustedProxies: ["loopback"],
    });
  });
});
