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

  it("rejects an empty server token flag", async () => {
    const process = createCapturedProcess({ PROXER_TOKEN: "env-secret" });

    await runCli(["server", "--token", "   "], process);

    expect(mocks.runServer).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("token must not be empty");
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
      route: { type: "subdomain", subdomain: "demo" },
      serverUrl: "wss://proxy.example.com/__proxer__/control",
      token: "secret",
    });
  });

  it("uses automatic HTTP subdomain assignment when no route is configured", async () => {
    await runCli(
      ["http", "3000"],
      createCapturedProcess({ PROXER_TOKEN: "secret" }),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "auto" },
      token: "secret",
    });
  });

  it("passes an HTTP cluster mode flag to the client", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo", "--mode", "cluster"],
      createCapturedProcess({ PROXER_TOKEN: "secret" }),
    );

    expect(firstHttpConfig()).toMatchObject({
      mode: "cluster",
      route: { type: "subdomain", subdomain: "demo" },
      token: "secret",
    });
  });

  it("uses HTTP cluster mode from the environment", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo"],
      createCapturedProcess({
        PROXER_MODE: "cluster",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({ mode: "cluster" });
  });

  it("passes an explicit HTTP single mode flag to the client", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo", "--mode", "single"],
      createCapturedProcess({ PROXER_TOKEN: "secret" }),
    );

    expect(firstHttpConfig()).toMatchObject({
      mode: "single",
      route: { type: "subdomain", subdomain: "demo" },
    });
  });

  it("prefers an HTTP mode flag over the environment", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo", "--mode", "single"],
      createCapturedProcess({
        PROXER_MODE: "cluster",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({ mode: "single" });
  });

  it("uses HTTP single mode from the environment", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo"],
      createCapturedProcess({
        PROXER_MODE: "single",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({ mode: "single" });
  });

  it("trims whitespace around HTTP mode values", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo"],
      createCapturedProcess({
        PROXER_MODE: "  cluster  ",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({ mode: "cluster" });
  });

  it("rejects an invalid HTTP tunnel mode from the environment", async () => {
    const process = createCapturedProcess({
      PROXER_MODE: "many",
      PROXER_TOKEN: "secret",
    });

    await runCli(["http", "3000", "--subdomain", "demo"], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("mode must be single or cluster");
  });

  it("rejects uppercase HTTP tunnel modes", async () => {
    const process = createCapturedProcess({ PROXER_TOKEN: "secret" });

    await runCli(["http", "3000", "--mode", "Cluster"], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("mode must be single or cluster");
  });

  it("composes HTTP cluster mode with root-domain routing", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "@", "--mode", "cluster"],
      createCapturedProcess({ PROXER_TOKEN: "secret" }),
    );

    expect(firstHttpConfig()).toMatchObject({
      mode: "cluster",
      route: { type: "root" },
    });
  });

  it("rejects an invalid HTTP tunnel mode", async () => {
    const process = createCapturedProcess({ PROXER_TOKEN: "secret" });

    await runCli(["http", "3000", "--mode", "many"], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("mode must be single or cluster");
  });

  it("uses root-domain routing for the HTTP subdomain flag sentinel", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "@"],
      createCapturedProcess({ PROXER_TOKEN: "secret" }),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "root" },
      token: "secret",
    });
  });

  it("uses root-domain routing for the HTTP subdomain environment sentinel", async () => {
    await runCli(
      ["http", "3000"],
      createCapturedProcess({
        PROXER_SUBDOMAIN: "@",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "root" },
      token: "secret",
    });
  });

  it("uses an HTTP basic auth password from the environment", async () => {
    await runCli(
      ["http", "3000"],
      createCapturedProcess({
        PROXER_BASIC_AUTH_PASSWORD: "site-secret",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      basicAuth: { password: "site-secret" },
    });
  });

  it("uses HTTP basic auth username and password from the environment", async () => {
    await runCli(
      ["http", "3000"],
      createCapturedProcess({
        PROXER_BASIC_AUTH_PASSWORD: "site-secret",
        PROXER_BASIC_AUTH_USERNAME: "admin",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      basicAuth: { password: "site-secret", username: "admin" },
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
      route: { type: "subdomain", subdomain: "flag" },
      serverUrl: "wss://flag.example.com/__proxer__/control",
      token: "flag-secret",
    });
  });

  it("prefers an HTTP subdomain flag over an environment root sentinel", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "demo"],
      createCapturedProcess({
        PROXER_SUBDOMAIN: "@",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "subdomain", subdomain: "demo" },
    });
  });

  it("prefers an HTTP root sentinel flag over an environment subdomain", async () => {
    await runCli(
      ["http", "3000", "--subdomain", "@"],
      createCapturedProcess({
        PROXER_SUBDOMAIN: "demo",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "root" },
    });
  });

  it("prefers HTTP basic auth flags over environment options", async () => {
    await runCli(
      [
        "http",
        "3000",
        "--basic-auth-username",
        "flag-user",
        "--basic-auth-password",
        "flag-pass",
      ],
      createCapturedProcess({
        PROXER_BASIC_AUTH_PASSWORD: "env-pass",
        PROXER_BASIC_AUTH_USERNAME: "env-user",
        PROXER_TOKEN: "secret",
      }),
    );

    expect(firstHttpConfig()).toMatchObject({
      basicAuth: { password: "flag-pass", username: "flag-user" },
    });
  });

  it("rejects an HTTP basic auth username without a password", async () => {
    const process = createCapturedProcess({
      PROXER_BASIC_AUTH_USERNAME: "admin",
      PROXER_TOKEN: "secret",
    });

    await runCli(["http", "3000"], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().stderr).toContain(
      "basic auth password is required when username is set",
    );
  });

  it("rejects an empty HTTP basic auth password flag", async () => {
    const process = createCapturedProcess({ PROXER_TOKEN: "secret" });

    await runCli(["http", "3000", "--basic-auth-password", "   "], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().stderr).toContain(
      "basic auth password must not be empty",
    );
  });

  it.each([
    ["dot", "bad.name", {}],
    ["underscore", "bad_name", {}],
    [
      "leading hyphen",
      undefined,
      { PROXER_SUBDOMAIN: "-bad", PROXER_TOKEN: "secret" },
    ],
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
        "--token",
        "secret",
      ],
      createCapturedProcess(),
    );

    expect(firstHttpConfig()).toMatchObject({
      route: { type: "subdomain", subdomain: "mixed-case" },
      token: "secret",
    });
  });

  it("rejects an HTTP client without a token", async () => {
    const process = createCapturedProcess();

    await runCli(["http", "3000"], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("token is required");
  });

  it("rejects an empty HTTP client token flag", async () => {
    const process = createCapturedProcess({ PROXER_TOKEN: "env-secret" });

    await runCli(["http", "3000", "--token", "   "], process);

    expect(mocks.runHttpClient).not.toHaveBeenCalled();
    expect(process.result().exitCode).not.toBe(0);
    expect(process.result().stderr).toContain("token must not be empty");
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
