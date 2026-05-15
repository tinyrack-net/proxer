import { beforeEach, describe, expect, test, vi } from "vitest";

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
}));

import {
  captureCommand,
  createPkgConfig,
  getPkgPaths,
  isNodeBuiltinSpecifier,
} from "./pkg.ts";

describe("isNodeBuiltinSpecifier", () => {
  test("returns true for node: prefixed builtins", () => {
    expect(isNodeBuiltinSpecifier("node:fs")).toBe(true);
    expect(isNodeBuiltinSpecifier("node:path")).toBe(true);
  });

  test("returns true for unprefixed builtins", () => {
    expect(isNodeBuiltinSpecifier("fs")).toBe(true);
    expect(isNodeBuiltinSpecifier("path")).toBe(true);
  });

  test("returns false for non-builtin specifiers", () => {
    expect(isNodeBuiltinSpecifier("zod")).toBe(false);
    expect(isNodeBuiltinSpecifier("./local")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isNodeBuiltinSpecifier("")).toBe(false);
  });
});

describe("captureCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns normalized spawn output", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: undefined,
      stderr: null,
      status: null,
      stdout: null,
    });

    expect(captureCommand("echo", ["hello"])).toEqual({
      exitCode: -1,
      signal: null,
      stderr: "",
      stdout: "",
    });
  });

  test("throws when spawnSync returns an error", () => {
    mockSpawnSync.mockReturnValue({
      error: new Error("ENOENT"),
      signal: null,
      stderr: "",
      status: null,
      stdout: "",
    });

    expect(() => captureCommand("missing-cmd", [])).toThrow(/ENOENT/u);
  });

  test("merges provided env with process.env", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: "",
      status: 0,
      stdout: "",
    });

    captureCommand("echo", ["hello"], { env: { FOO: "bar" } });

    const callOptions = mockSpawnSync.mock.calls[0]?.[2] as {
      env: Record<string, string> & { FOO: string };
    };

    expect(callOptions.env.FOO).toBe("bar");
  });
});

describe("getPkgPaths", () => {
  test("returns default Linux executable and bundle paths", () => {
    const paths = getPkgPaths({ repoRoot: "/repo", platform: "linux" });

    expect(paths.cliDir).toBe("/repo/packages/cli");
    expect(paths.bundlePath).toBe("/repo/packages/cli/dist/pkg/proxer.mjs");
    expect(paths.executablePath).toBe("/repo/packages/cli/dist/pkg/proxer");
    expect(paths.pkgConfigPath).toBe(
      "/repo/packages/cli/dist/pkg/pkg.config.mjs",
    );
  });

  test("returns Windows executable path", () => {
    const paths = getPkgPaths({ repoRoot: "/repo", platform: "win32" });

    expect(paths.executablePath).toBe("/repo/packages/cli/dist/pkg/proxer.exe");
  });
});

describe("createPkgConfig", () => {
  test("uses node24 SEA defaults", () => {
    expect(createPkgConfig({})).toEqual({
      targets: ["node24"],
      outputPath: "dist/pkg",
      sea: true,
      seaConfig: {
        useCodeCache: true,
        disableExperimentalSEAWarning: true,
      },
    });
  });

  test("splits explicit targets and includes compression", () => {
    expect(
      createPkgConfig({
        target: "node24-linux-x64,node24-win-x64",
        compress: "GZip",
      }),
    ).toEqual({
      targets: ["node24-linux-x64", "node24-win-x64"],
      outputPath: "dist/pkg",
      sea: true,
      seaConfig: {
        useCodeCache: true,
        disableExperimentalSEAWarning: true,
      },
      compress: "GZip",
    });
  });
});
