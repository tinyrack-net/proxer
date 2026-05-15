import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const performRelease = vi.fn();

vi.mock("../lib/release.ts", () => ({
  performRelease,
  releaseTypeSchema: {
    options: ["patch", "minor", "major"],
    safeParseAsync: async (input: string) => ({
      success: ["patch", "minor", "major"].includes(input),
      data: input,
    }),
  },
}));

describe("tools cli", () => {
  beforeEach(() => {
    performRelease.mockReset();
    performRelease.mockResolvedValue({
      dryRun: true,
      previousTag: "v0.0.3",
      tag: "v0.1.0",
      version: "0.1.0",
    });
  });

  test("passes --dry-run to the release command", async () => {
    const { runCli } = await import("./app.ts");

    await runCli(["release", "minor", "--dry-run"], {
      process: {
        env: process.env,
        exitCode: null,
        stdout: process.stdout,
        stderr: process.stderr,
      },
    });

    expect(performRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        dryRun: true,
        releaseType: "minor",
      }),
    );
  });

  test("generates syntactically valid Ruby formula with balanced blocks", async () => {
    const artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxer-"));
    for (const name of [
      "proxer-macos-arm64",
      "proxer-macos-x64",
      "proxer-linux-x64",
      "proxer-linux-arm64",
    ]) {
      await fs.writeFile(path.join(artifactsDir, name), name);
    }

    const { runCli } = await import("./app.ts");

    await runCli(
      [
        "homebrew",
        "generate",
        "--version",
        "v0.42.9",
        "--artifacts-dir",
        artifactsDir,
      ],
      {
        process: {
          env: process.env,
          exitCode: null,
          stdout: process.stdout,
          stderr: process.stderr,
        },
      },
    );

    const formula = await fs.readFile(
      path.join(artifactsDir, "proxer.rb"),
      "utf8",
    );

    expect(formula).toContain("class Proxer < Formula");
    expect(formula).toContain("def install");
    expect(formula).toContain("test do");
    expect(formula).toContain(
      'desc "Reverse tunnel CLI for HTTP, SSE, and WebSocket traffic"',
    );
  });
});
