import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import http from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listenOnRandomPort } from "#app/test/local-servers.ts";

type SpawnedCli = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: {
    stderr: string;
    stdout: string;
  };
};

const packageRoot = resolve(import.meta.dirname, "../..");
const cliEntrypoint = resolve(packageRoot, "dist/index.js");

const closeHttpServer = async (server: http.Server): Promise<void> => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolveClose();
    });
  });
};

const createLocalHttpServer = async (): Promise<{
  readonly port: number;
  close(): Promise<void>;
}> => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(`cli-e2e:${request.method}:${request.url}\n`);
  });
  const address = await listenOnRandomPort(server);

  return {
    port: address.port,
    async close() {
      await closeHttpServer(server);
    },
  };
};

const getFreePort = async (): Promise<number> => {
  const server = http.createServer();
  const address = await listenOnRandomPort(server);
  await closeHttpServer(server);

  return address.port;
};

const spawnCli = (args: readonly string[]): SpawnedCli => {
  const child = spawn(process.execPath, [cliEntrypoint, ...args], {
    cwd: packageRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = { stderr: "", stdout: "" };

  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    output.stderr += chunk;
  });

  return { child, output };
};

const combinedOutput = ({ output }: SpawnedCli): string => {
  return `${output.stdout}${output.stderr}`;
};

const waitForOutput = async (
  spawned: SpawnedCli,
  pattern: RegExp,
  timeoutMs = 3_000,
): Promise<RegExpExecArray> => {
  return await new Promise((resolveMatch, reject) => {
    const checkOutput = (): void => {
      const match = pattern.exec(combinedOutput(spawned));
      if (!match) {
        return;
      }

      cleanup();
      resolveMatch(match);
    };
    const onExit = (): void => {
      cleanup();
      reject(
        new Error(
          `CLI process exited before expected output ${pattern}:\n${combinedOutput(spawned)}`,
        ),
      );
    };
    const onTimeout = (): void => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for expected output ${pattern}:\n${combinedOutput(spawned)}`,
        ),
      );
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      spawned.child.stdout.off("data", checkOutput);
      spawned.child.stderr.off("data", checkOutput);
      spawned.child.off("exit", onExit);
    };
    const timer = setTimeout(onTimeout, timeoutMs);

    spawned.child.stdout.on("data", checkOutput);
    spawned.child.stderr.on("data", checkOutput);
    spawned.child.once("exit", onExit);
    checkOutput();
  });
};

const waitForExit = async (
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolveExit, reject) => {
    const onExit = (): void => {
      cleanup();
      resolveExit();
    };
    const onTimeout = (): void => {
      cleanup();
      reject(new Error("CLI process did not exit after signal"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    const timer = setTimeout(onTimeout, timeoutMs);

    child.once("exit", onExit);
  });
};

const stopCli = async ({ child }: SpawnedCli): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  try {
    await waitForExit(child, 2_000);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child, 1_000);
  }
};

const requestPublic = async (
  publicUrl: string,
): Promise<{
  readonly body: string;
  readonly status: number;
}> => {
  return await new Promise((resolveResponse, reject) => {
    const request = http.request(
      new URL("/", publicUrl),
      { headers: { host: "demo.proxy.localhost" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolveResponse({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
};

describe("CLI E2E", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("proxies HTTP through real built CLI server and client processes", async () => {
    const localServer = await createLocalHttpServer();
    cleanups.push(() => localServer.close());
    const serverPort = await getFreePort();

    const serverProcess = spawnCli([
      "server",
      "--listen",
      `127.0.0.1:${serverPort}`,
      "--domain",
      "proxy.localhost",
      "--token",
      "e2e-token",
    ]);
    cleanups.push(() => stopCli(serverProcess));
    const publicMatch = await waitForOutput(
      serverProcess,
      /^public: (http:\/\/127\.0\.0\.1:\d+)$/m,
    );
    const publicUrl = publicMatch[1];
    if (!publicUrl) {
      throw new Error(
        `CLI did not print a public URL:\n${combinedOutput(serverProcess)}`,
      );
    }

    const clientProcess = spawnCli([
      "http",
      String(localServer.port),
      "--server",
      publicUrl,
      "--subdomain",
      "demo",
      "--token",
      "e2e-token",
    ]);
    cleanups.push(() => stopCli(clientProcess));
    await waitForOutput(clientProcess, /^subdomain: demo$/m);

    const response = await requestPublic(publicUrl);

    expect(response.status).toBe(200);
    expect(response.body).toBe("cli-e2e:GET:/\n");
  });
});
