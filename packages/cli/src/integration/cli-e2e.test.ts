import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import http from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createLocalSseServer,
  createLocalWebSocketEchoServer,
  listenOnRandomPort,
} from "#app/test/local-servers.ts";

type SpawnedCli = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: {
    stderr: string;
    stdout: string;
  };
};

const packageRoot = resolve(import.meta.dirname, "../..");
const cliEntrypoint = resolve(packageRoot, "dist/index.js");

const basic = (value: string): string => {
  return `Basic ${Buffer.from(value).toString("base64")}`;
};

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

const spawnCli = (
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): SpawnedCli => {
  const child = spawn(process.execPath, [cliEntrypoint, ...args], {
    cwd: packageRoot,
    env: { ...process.env, NO_COLOR: "1", ...options.env },
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
  options: { readonly authorization?: string; readonly host?: string } = {},
): Promise<{
  readonly body: string;
  readonly status: number;
}> => {
  return await new Promise((resolveResponse, reject) => {
    const request = http.request(
      new URL("/", publicUrl),
      {
        headers: {
          ...(options.authorization
            ? { authorization: options.authorization }
            : {}),
          host: options.host ?? "demo.proxy.localhost",
        },
      },
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

const requestPublicSse = (
  publicUrl: string,
  options: { readonly host?: string } = {},
): {
  readonly firstChunk: Promise<string>;
  readonly fullResponse: Promise<{
    readonly body: string;
    readonly headers: http.IncomingHttpHeaders;
    readonly status: number;
  }>;
} => {
  let resolveFirstChunk: (chunk: string) => void = () => {};
  let rejectFirstChunk: (error: Error) => void = () => {};
  const firstChunk = new Promise<string>((resolveChunk, reject) => {
    resolveFirstChunk = resolveChunk;
    rejectFirstChunk = reject;
  });
  const fullResponse = new Promise<{
    body: string;
    headers: http.IncomingHttpHeaders;
    status: number;
  }>((resolveResponse, reject) => {
    const request = http.request(
      new URL("/events", publicUrl),
      { headers: { host: options.host ?? "demo.proxy.localhost" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.once("data", (chunk: Buffer) => {
          resolveFirstChunk(Buffer.from(chunk).toString("utf8"));
        });
        response.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolveResponse({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", (error) => {
      rejectFirstChunk(error);
      reject(error);
    });
    request.end();
  });

  return { firstChunk, fullResponse };
};

const openPublicWebSocket = async (
  publicUrl: string,
  options: { readonly host?: string } = {},
): Promise<WebSocket> => {
  const publicWebSocketUrl = publicUrl.replace("http://", "ws://");
  const socket = new WebSocket(`${publicWebSocketUrl}/echo`, {
    headers: { host: options.host ?? "demo.proxy.localhost" },
  });

  await new Promise<void>((resolveOpen, reject) => {
    socket.once("open", resolveOpen);
    socket.once("error", reject);
  });

  return socket;
};

const waitForMessage = async (
  socket: WebSocket,
): Promise<{ readonly data: Buffer; readonly isBinary: boolean }> => {
  return await new Promise((resolveMessage, reject) => {
    socket.once("message", (data, isBinary) => {
      resolveMessage({ data: Buffer.from(data as Buffer), isBinary });
    });
    socket.once("error", reject);
  });
};

const closeWebSocket = async (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolveClose) => {
    const timer = setTimeout(() => {
      socket.terminate();
      resolveClose();
    }, 1_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolveClose();
    });
    socket.close();
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

  it("uses an auto-assigned subdomain by default in real built CLI client processes", async () => {
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
    const clientServerUrl =
      process.platform === "win32"
        ? publicUrl
        : `http://proxy.localhost:${serverPort}`;

    const clientProcess = spawnCli([
      "http",
      String(localServer.port),
      "--server",
      clientServerUrl,
      "--token",
      "e2e-token",
    ]);
    cleanups.push(() => stopCli(clientProcess));
    const subdomainMatch = await waitForOutput(
      clientProcess,
      /^subdomain: ([a-z0-9-]+)$/m,
    );
    const subdomain = subdomainMatch[1];
    expect(subdomain).toMatch(/^px-/);
    if (process.platform === "win32") {
      await waitForOutput(
        clientProcess,
        /^public: http:\/\/127\.0\.0\.1:\d+$/m,
      );
    } else {
      const clientPublicMatch = await waitForOutput(
        clientProcess,
        new RegExp(`^public: .*${subdomain}.*$`, "m"),
      );
      expect(clientPublicMatch[0]).toContain(`public: http://${subdomain}.`);
    }

    const response = await requestPublic(publicUrl, {
      host: `${subdomain}.proxy.localhost`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe("cli-e2e:GET:/\n");
  });

  it("uses root routing for the built CLI --subdomain @ sentinel", async () => {
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
      "@",
      "--token",
      "e2e-token",
    ]);
    cleanups.push(() => stopCli(clientProcess));
    await waitForOutput(clientProcess, /^route: root domain$/m);

    const response = await requestPublic(publicUrl, {
      host: "proxy.localhost",
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe("cli-e2e:GET:/\n");
  });

  it("uses root routing for the built CLI PROXER_SUBDOMAIN=@ sentinel", async () => {
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

    const clientProcess = spawnCli(
      [
        "http",
        String(localServer.port),
        "--server",
        publicUrl,
        "--token",
        "e2e-token",
      ],
      { env: { PROXER_SUBDOMAIN: "@" } },
    );
    cleanups.push(() => stopCli(clientProcess));
    await waitForOutput(clientProcess, /^route: root domain$/m);

    const response = await requestPublic(publicUrl, {
      host: "proxy.localhost",
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe("cli-e2e:GET:/\n");
  });

  it("honors env-based public basic auth in real built CLI client processes", async () => {
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

    const clientProcess = spawnCli(
      [
        "http",
        String(localServer.port),
        "--server",
        publicUrl,
        "--token",
        "e2e-token",
      ],
      {
        env: {
          PROXER_BASIC_AUTH_PASSWORD: "site-secret",
          PROXER_BASIC_AUTH_USERNAME: "admin",
        },
      },
    );
    cleanups.push(() => stopCli(clientProcess));
    const subdomainMatch = await waitForOutput(
      clientProcess,
      /^subdomain: ([a-z0-9-]+)$/m,
    );
    const host = `${subdomainMatch[1]}.proxy.localhost`;

    const missingAuthResponse = await requestPublic(publicUrl, { host });
    const wrongUsernameResponse = await requestPublic(publicUrl, {
      authorization: basic("other:site-secret"),
      host,
    });
    const authorizedResponse = await requestPublic(publicUrl, {
      authorization: basic("admin:site-secret"),
      host,
    });

    expect(missingAuthResponse.status).toBe(401);
    expect(wrongUsernameResponse.status).toBe(401);
    expect(authorizedResponse.status).toBe(200);
    expect(authorizedResponse.body).toBe("cli-e2e:GET:/\n");
  });

  it("proxies SSE through real built CLI server and client processes without buffering", async () => {
    let localResponseEnded = false;
    let secondEventWritten = false;
    const localServer = await createLocalSseServer({
      onResponseEnded() {
        localResponseEnded = true;
      },
      onSecondEventWritten() {
        secondEventWritten = true;
      },
    });
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

    const { firstChunk, fullResponse } = requestPublicSse(publicUrl);
    const observedFirstChunk = await firstChunk;

    expect(observedFirstChunk).toBe("data: one\n\n");
    expect(localResponseEnded).toBe(false);
    expect(secondEventWritten).toBe(false);

    const response = await fullResponse;

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.body).toBe("data: one\n\ndata: two\n\n");
  });

  it("proxies WebSocket text and binary messages through real built CLI server and client processes", async () => {
    const localServer = await createLocalWebSocketEchoServer();
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
    const publicSocket = await openPublicWebSocket(publicUrl);
    cleanups.push(() => closeWebSocket(publicSocket));

    publicSocket.send("hello");
    const textMessage = await waitForMessage(publicSocket);
    expect(textMessage.isBinary).toBe(false);
    expect(textMessage.data.toString("utf8")).toBe("hello");

    publicSocket.send(Buffer.from([1, 2, 3]));
    const binaryMessage = await waitForMessage(publicSocket);
    expect(binaryMessage.isBinary).toBe(true);
    expect(binaryMessage.data).toEqual(Buffer.from([1, 2, 3]));
  });
});
