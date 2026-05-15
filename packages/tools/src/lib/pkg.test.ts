import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockPkgExec = vi.hoisted(() => vi.fn());
const mockViteBuild = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock("@yao-pkg/pkg", () => ({
  exec: mockPkgExec,
}));

vi.mock("vite", () => ({
  build: mockViteBuild,
}));

import {
  captureCommand,
  createPkgConfig,
  getPkgPaths,
  isNodeBuiltinSpecifier,
  performPkgBuild,
  performPkgSmoke,
} from "./pkg.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

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

    expect(paths.cliDir).toBe(join("/repo", "packages", "cli"));
    expect(paths.bundlePath).toBe(
      join("/repo", "packages", "cli", "dist", "pkg", "proxer.mjs"),
    );
    expect(paths.executablePath).toBe(
      join("/repo", "packages", "cli", "dist", "pkg", "proxer"),
    );
    expect(paths.pkgConfigPath).toBe(
      join("/repo", "packages", "cli", "dist", "pkg", "pkg.config.mjs"),
    );
  });

  test("returns Windows executable path", () => {
    const paths = getPkgPaths({ repoRoot: "/repo", platform: "win32" });

    expect(paths.executablePath).toBe(
      join("/repo", "packages", "cli", "dist", "pkg", "proxer.exe"),
    );
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

describe("performPkgBuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("configures Vite as an SSR Node bundle for pkg", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "proxer-pkg-build-"));
    temporaryDirectories.push(repoRoot);
    await mkdir(join(repoRoot, "packages", "cli", "dist"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: "",
      status: 0,
      stdout: "",
    });
    mockViteBuild.mockImplementation(async (config: unknown) => {
      const outDir = (config as { build: { outDir: string } }).build.outDir;
      await writeFile(join(outDir, "proxer.mjs"), "console.log('bundle');\n");
    });
    mockPkgExec.mockResolvedValue(undefined);

    await performPkgBuild({ repoRoot, target: "node24-linux-x64" });

    const viteConfig = mockViteBuild.mock.calls[0]?.[0] as {
      build: {
        lib?: unknown;
        rollupOptions: { output: { entryFileNames: string; format: string } };
        ssr?: string;
      };
      ssr?: { noExternal?: boolean };
    };
    expect(viteConfig.build.ssr).toBe(
      join(repoRoot, "packages", "cli", "dist", "index.js"),
    );
    expect(viteConfig.ssr?.noExternal).toBe(true);
    expect(viteConfig.build.lib).toBeUndefined();
    expect(viteConfig.build.rollupOptions.output).toEqual({
      entryFileNames: "proxer.mjs",
      format: "es",
    });
  });
});

describe("performPkgSmoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("checks CLI help commands and version output", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "proxer-pkg-smoke-"));
    temporaryDirectories.push(repoRoot);
    await mkdir(join(repoRoot, "packages", "cli"), { recursive: true });
    await writeFile(
      join(repoRoot, "packages", "cli", "package.json"),
      JSON.stringify({ version: "1.2.3" }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockSpawnSync
      .mockReturnValueOnce({
        error: undefined,
        signal: null,
        stderr: "",
        status: 0,
        stdout: "COMMANDS\n  server\n  http\n",
      })
      .mockReturnValueOnce({
        error: undefined,
        signal: null,
        stderr: "",
        status: 0,
        stdout: "proxer 1.2.3\n",
      });

    await performPkgSmoke({ repoRoot, skipBuild: true });

    const defaultExecutableName =
      process.platform === "win32" ? "proxer.exe" : "proxer";

    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      join(repoRoot, "packages", "cli", "dist", "pkg", defaultExecutableName),
      ["--help"],
      expect.objectContaining({ cwd: repoRoot }),
    );
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      join(repoRoot, "packages", "cli", "dist", "pkg", defaultExecutableName),
      ["--version"],
      expect.objectContaining({ cwd: repoRoot }),
    );
  });
});
