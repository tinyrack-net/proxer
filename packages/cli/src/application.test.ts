import { EventEmitter } from "node:events";
import net from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildProxerApplication,
  type RunCliOptions,
  runCli,
} from "#app/application.ts";
import packageJson from "../package.json" with { type: "json" };

const createCapturedProcess = (
  onStdout?: (output: string, process: EventEmitter) => void,
) => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let exitCode: number | undefined;
  const process = new EventEmitter() as EventEmitter & RunCliOptions;

  stdout.on("data", (chunk) => {
    stdoutChunks.push(Buffer.from(chunk));
    onStdout?.(Buffer.concat(stdoutChunks).toString("utf8"), process);
  });
  stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  Object.defineProperties(process, {
    env: { value: {} },
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

  return {
    process,
    result() {
      return {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      };
    },
  };
};

const runWithCapturedOutput = async (
  args: string[],
  onStdout?: (output: string, process: EventEmitter) => void,
) => {
  const captured = createCapturedProcess(onStdout);

  await runCli(args, captured.process);

  return captured.result();
};

const getUnusedPort = async (): Promise<number> => {
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("server did not bind to a TCP address");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return address.port;
};

describe("proxer CLI", () => {
  it("builds the application", () => {
    expect(buildProxerApplication()).toBeDefined();
  });

  it("root help lists server and http commands", async () => {
    const result = await runWithCapturedOutput(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("server");
    expect(result.stdout).toContain("http");
    expect(result.stderr).toBe("");
  });

  it("prints version information", async () => {
    const result = await runWithCapturedOutput(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`proxer ${packageJson.version}`);
  });

  it("server command starts a single listener until a shutdown signal", async () => {
    const listenPort = await getUnusedPort();
    let signaled = false;
    const result = await runWithCapturedOutput(
      ["server", "--listen", `127.0.0.1:${listenPort}`],
      (output, process) => {
        if (!signaled && output.includes("control: ws://")) {
          signaled = true;
          queueMicrotask(() => process.emit("SIGINT"));
        }
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`public: http://127.0.0.1:${listenPort}`);
    expect(result.stdout).toContain(
      `control: ws://127.0.0.1:${listenPort}/__proxer_control_7f3d9a2b__`,
    );
    expect(result.stdout).toContain("server stopped");
  });

  it("http command requires a tunnel name", async () => {
    const result = await runWithCapturedOutput(["http", "3000"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--name is required");
  });
});
