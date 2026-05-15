import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildProxerApplication, runCli } from "#app/application.ts";

const runWithCapturedOutput = async (args: string[]) => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let exitCode: number | undefined;

  stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  await runCli(args, {
    stdout,
    stderr,
    env: {},
    get exitCode() {
      return exitCode;
    },
    set exitCode(value) {
      exitCode = value;
    },
  });

  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
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
    expect(result.stdout).toContain("proxer 0.0.0");
  });

  it("server command logs parsed default addresses", async () => {
    const result = await runWithCapturedOutput(["server"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("public: 127.0.0.1:8080");
    expect(result.stdout).toContain("control: 127.0.0.1:7000");
  });

  it("http command requires a tunnel name", async () => {
    const result = await runWithCapturedOutput(["http", "3000"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--name is required");
  });
});
