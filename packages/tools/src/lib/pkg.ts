import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";
import { exec } from "@yao-pkg/pkg";
import { build as viteBuild } from "vite";

const require = createRequire(import.meta.url);

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type CommandResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};

const builtinSpecifiers = new Set(
  builtinModules.flatMap((entry) =>
    entry.startsWith("node:")
      ? [entry, entry.slice("node:".length)]
      : [entry, `node:${entry}`],
  ),
);

export const isNodeBuiltinSpecifier = (specifier: string): boolean => {
  return builtinSpecifiers.has(specifier);
};

export const captureCommand = (
  command: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    exitCode: result.status ?? -1,
    signal: result.signal ?? null,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

export type SeaCompressAlgorithm = "Brotli" | "GZip" | "Zstd";

export type PkgPaths = {
  bundlePath: string;
  cliDir: string;
  distDirectory: string;
  executablePath: string;
  pkgConfigPath: string;
  pkgOutputDirectory: string;
};

export function getPkgPaths(options: {
  repoRoot: string;
  platform?: NodeJS.Platform;
  target?: string;
}): PkgPaths {
  const cliDir = join(options.repoRoot, "packages", "cli");
  const distDirectory = join(cliDir, "dist");
  const pkgOutputDirectory = join(distDirectory, "pkg");
  const isMultiTarget = options.target?.includes(",") ?? false;
  const isWin =
    !isMultiTarget &&
    (options.target
      ? options.target.includes("win")
      : (options.platform ?? process.platform) === "win32");

  return {
    bundlePath: join(pkgOutputDirectory, "proxer.mjs"),
    cliDir,
    distDirectory,
    executablePath: join(pkgOutputDirectory, isWin ? "proxer.exe" : "proxer"),
    pkgConfigPath: join(pkgOutputDirectory, "pkg.config.mjs"),
    pkgOutputDirectory,
  };
}

export function createPkgConfig(options: {
  compress?: SeaCompressAlgorithm;
  outputPath?: string;
  target?: string;
}): Record<string, unknown> {
  return {
    targets: (options.target ?? "node24")
      .split(",")
      .map((target) => target.trim()),
    outputPath: options.outputPath ?? "dist/pkg",
    sea: true,
    seaConfig: {
      useCodeCache: true,
      disableExperimentalSEAWarning: true,
    },
    ...(options.compress !== undefined ? { compress: options.compress } : {}),
  };
}

export function validateBundleImports(bundleSource: string): void {
  const importPatterns = [
    /^\s*import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
    /^\s*import\s+["']([^"']+)["'];?$/gm,
    /^\s*export\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
    /require\(["']([^"']+)["']\)/g,
  ];
  const unexpectedImports = new Set<string>();

  for (const pattern of importPatterns) {
    let match = pattern.exec(bundleSource);

    while (match !== null) {
      const specifier = match[1];

      if (specifier !== undefined && !isNodeBuiltinSpecifier(specifier)) {
        unexpectedImports.add(specifier);
      }

      match = pattern.exec(bundleSource);
    }
  }

  if (unexpectedImports.size > 0) {
    throw new Error(
      `pkg bundle still has non-builtin imports: ${[...unexpectedImports]
        .sort()
        .join(", ")}`,
    );
  }
}

export async function performPkgBuild(options: {
  compress?: SeaCompressAlgorithm;
  repoRoot: string;
  target?: string;
}): Promise<void> {
  const paths = getPkgPaths({
    repoRoot: options.repoRoot,
    ...(options.target !== undefined ? { target: options.target } : {}),
  });
  const bundleFileName = "proxer.mjs";

  console.log("Building dist/ output...");
  const tscResult = captureCommand(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    { cwd: paths.cliDir },
  );

  if (tscResult.exitCode !== 0) {
    throw new Error(
      `TypeScript build failed:\n${tscResult.stdout}\n${tscResult.stderr}`,
    );
  }

  console.log("Bundling dist/index.js for pkg...");
  await rm(paths.pkgOutputDirectory, { force: true, recursive: true });
  await mkdir(paths.pkgOutputDirectory, { recursive: true });

  await viteBuild({
    appType: "custom",
    root: paths.cliDir,
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      minify: false,
      outDir: paths.pkgOutputDirectory,
      reportCompressedSize: false,
      rollupOptions: {
        external: (specifier: string) => {
          return (
            typeof specifier === "string" && isNodeBuiltinSpecifier(specifier)
          );
        },
        output: {
          entryFileNames: bundleFileName,
          format: "es",
        },
      },
      sourcemap: false,
      ssr: join(paths.distDirectory, "index.js"),
      target: "node24",
    },
    logLevel: "info",
    ssr: {
      noExternal: true,
    },
  });

  validateBundleImports(await readFile(paths.bundlePath, "utf8"));
  console.log(`pkg bundle written to ${paths.bundlePath}`);

  const pkgConfig = createPkgConfig({
    ...(options.compress !== undefined ? { compress: options.compress } : {}),
    outputPath: paths.pkgOutputDirectory,
    ...(options.target !== undefined ? { target: options.target } : {}),
  });
  await writeFile(
    paths.pkgConfigPath,
    `export default ${JSON.stringify(pkgConfig, null, 2)};\n`,
  );

  const pkgTarget = options.target ?? "node24";
  const execArgs = [
    "-t",
    pkgTarget,
    paths.bundlePath,
    "--config",
    paths.pkgConfigPath,
    "--no-signature",
  ];

  if (!pkgTarget.includes(",")) {
    execArgs.push("-o", paths.executablePath);
  }

  console.log(`Generating SEA executable for ${pkgTarget}...`);
  await exec(execArgs);

  if (pkgTarget.includes(",")) {
    console.log(`SEA executables generated in ${paths.pkgOutputDirectory}`);
  } else {
    console.log(`SEA executable generated at ${paths.executablePath}`);
  }
}

export async function performPkgSmoke(options: {
  executablePath?: string;
  repoRoot: string;
  skipBuild: boolean;
}): Promise<void> {
  if (!options.skipBuild) {
    await performPkgBuild({ repoRoot: options.repoRoot });
  }

  const cliPackageJson = JSON.parse(
    await readFile(
      join(options.repoRoot, "packages", "cli", "package.json"),
      "utf8",
    ),
  ) as { version: string };
  const executablePath =
    options.executablePath !== undefined
      ? join(options.repoRoot, options.executablePath)
      : getPkgPaths({ repoRoot: options.repoRoot }).executablePath;
  const smokeEnvironment = {
    FORCE_COLOR: "0",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: "",
    NO_COLOR: "1",
  };
  const result = captureCommand(executablePath, ["--help"], {
    cwd: options.repoRoot,
    env: smokeEnvironment,
  });

  assertCommandSucceeded("pkg help smoke", result);
  assertIncludes("pkg help smoke stdout", result.stdout, "COMMANDS");
  assertIncludes("pkg help smoke stdout", result.stdout, "server");
  assertIncludes("pkg help smoke stdout", result.stdout, "http");
  assertEmpty("pkg help smoke stderr", result.stderr);

  const versionResult = captureCommand(executablePath, ["--version"], {
    cwd: options.repoRoot,
    env: smokeEnvironment,
  });

  assertCommandSucceeded("pkg version smoke", versionResult);
  assertIncludes(
    "pkg version smoke stdout",
    versionResult.stdout,
    `proxer ${cliPackageJson.version}`,
  );
  assertEmpty("pkg version smoke stderr", versionResult.stderr);

  console.log(`pkg smoke test passed with ${executablePath}`);
}

const assertCommandSucceeded = (label: string, result: CommandResult): void => {
  if (result.exitCode === 0) {
    return;
  }

  const signalSuffix =
    result.signal === null ? "" : `, signal: ${result.signal}`;

  throw new Error(
    `${label} failed with exit code ${result.exitCode}${signalSuffix}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
};

const assertIncludes = (
  label: string,
  actual: string,
  expected: string,
): void => {
  if (actual.includes(expected)) {
    return;
  }

  throw new Error(
    `${label} did not include ${JSON.stringify(expected)}.\nactual output:\n${actual}`,
  );
};

const assertEmpty = (label: string, actual: string): void => {
  if (actual === "") {
    return;
  }

  throw new Error(
    `${label} was expected to be empty.\nactual output:\n${actual}`,
  );
};
