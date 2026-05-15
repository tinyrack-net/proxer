#!/usr/bin/env node
import {
  performPkgBuild,
  performPkgSmoke,
  type SeaCompressAlgorithm,
} from "#tools/lib/pkg.ts";
import { findRepoRoot } from "#tools/lib/workspace.ts";

const COMPRESS_ALGORITHMS = new Set<string>(["Brotli", "GZip", "Zstd"]);

const args = process.argv.slice(2);

try {
  await run(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function run(argv: string[]): Promise<void> {
  const [group, command, ...rest] = argv;

  if (group !== "pkg" || (command !== "build" && command !== "smoke")) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const repoRoot = await findRepoRoot(process.cwd());

  const commandArgs = rest.filter((arg) => arg !== "--");

  if (command === "build") {
    const flags = parseBuildFlags(commandArgs);
    await performPkgBuild({ repoRoot, ...flags });
    return;
  }

  const flags = parseSmokeFlags(commandArgs);
  await performPkgSmoke({ repoRoot, ...flags });
}

function parseBuildFlags(args: string[]): {
  compress?: SeaCompressAlgorithm;
  target?: string;
} {
  const flags: { compress?: SeaCompressAlgorithm; target?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--target" && value !== undefined) {
      flags.target = value;
      index += 1;
      continue;
    }

    if (arg === "--compress" && value !== undefined) {
      flags.compress = parseCompress(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete pkg build argument: ${arg ?? ""}`);
  }

  return flags;
}

function parseSmokeFlags(args: string[]): {
  executablePath?: string;
  skipBuild: boolean;
} {
  const flags: { executablePath?: string; skipBuild: boolean } = {
    skipBuild: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--skip-build") {
      flags.skipBuild = true;
      continue;
    }

    if (arg === "--executable-path" && value !== undefined) {
      flags.executablePath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete pkg smoke argument: ${arg ?? ""}`);
  }

  return flags;
}

function parseCompress(value: string): SeaCompressAlgorithm {
  if (!COMPRESS_ALGORITHMS.has(value)) {
    throw new Error(
      `Invalid compress algorithm: ${value}. Must be one of: ${[
        ...COMPRESS_ALGORITHMS,
      ].join(", ")}`,
    );
  }

  return value as SeaCompressAlgorithm;
}

function printUsage(): void {
  console.error("Usage: proxer-tools pkg <build|smoke> [options]");
}
