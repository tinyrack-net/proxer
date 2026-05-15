import { EventEmitter } from "node:events";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
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

const createTempDirectory = async (): Promise<string> => {
  return await mkdtemp(path.join(tmpdir(), "proxer-cli-"));
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
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
    expect(result.stdout).toContain("skill");
    expect(result.stderr).toBe("");
  });

  it("skill help lists install", async () => {
    const result = await runWithCapturedOutput(["skill", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("install");
    expect(result.stderr).toBe("");
  });

  it("skill install help lists only skill installer options", async () => {
    const result = await runWithCapturedOutput(["skill", "install", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<directory>");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).not.toContain("--server");
    expect(result.stdout).not.toContain("--token");
    expect(result.stdout).not.toContain("--control-path");
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
      `control: ws://127.0.0.1:${listenPort}/__proxer__/control`,
    );
    expect(result.stdout).toContain("server stopped");
  });

  it("http help lists subdomain routing without the removed name flag", async () => {
    const result = await runWithCapturedOutput(["http", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--subdomain");
    expect(result.stdout).not.toContain("--control-path");
    expect(result.stderr).toBe("");
  });

  it("server help does not list the removed control path flag", async () => {
    const result = await runWithCapturedOutput(["server", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("--control-path");
    expect(result.stderr).toBe("");
  });

  it("skill install writes proxer.md and prints installed path", async () => {
    const directory = path.join(await createTempDirectory(), "skills");
    const targetPath = path.resolve(directory, "proxer.md");

    const result = await runWithCapturedOutput(["skill", "install", directory]);
    const content = await readFile(targetPath, "utf8");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`installed skill: ${targetPath}`);
    expect(result.stderr).toBe("");
    expect(content).toContain("proxer skill");
    expect(content).toContain("/__proxer__/control");
  });

  it("skill install --dry-run prints would install and writes nothing", async () => {
    const directory = path.join(
      await createTempDirectory(),
      "nested",
      "skills",
    );
    const targetPath = path.resolve(directory, "proxer.md");

    const result = await runWithCapturedOutput([
      "skill",
      "install",
      directory,
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`would install skill: ${targetPath}`);
    expect(result.stderr).toBe("");
    expect(await pathExists(directory)).toBe(false);
    expect(await pathExists(targetPath)).toBe(false);
  });

  it("skill install refuses existing file without --force", async () => {
    const directory = await createTempDirectory();
    const targetPath = path.join(directory, "proxer.md");
    await writeFile(targetPath, "existing skill\n", "utf8");

    const result = await runWithCapturedOutput(["skill", "install", directory]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `skill already exists: ${path.resolve(targetPath)} (use --force to overwrite)`,
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "existing skill\n",
    );
  });

  it("skill install --force overwrites existing file", async () => {
    const directory = await createTempDirectory();
    const targetPath = path.join(directory, "proxer.md");
    await writeFile(targetPath, "stale skill\n", "utf8");

    const result = await runWithCapturedOutput([
      "skill",
      "install",
      directory,
      "--force",
    ]);
    const content = await readFile(targetPath, "utf8");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `installed skill: ${path.resolve(targetPath)}`,
    );
    expect(result.stderr).toBe("");
    expect(content).not.toBe("stale skill\n");
    expect(content).toContain("proxer skill");
  });
});
