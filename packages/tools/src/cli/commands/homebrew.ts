import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";

async function calculateSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

type GenerateFormulaFlags = {
  version: string;
  artifactsDir: string;
};

export const generateFormulaCommand = buildCommand<GenerateFormulaFlags, []>({
  parameters: {
    flags: {
      version: {
        kind: "parsed",
        brief: "Release version (e.g., v1.0.0)",
        parse: String,
      },
      artifactsDir: {
        kind: "parsed",
        brief: "Directory containing the release artifacts",
        parse: String,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  async func(flags) {
    const { version, artifactsDir: rawArtifactsDir } = flags;
    const cleanVersion = version.startsWith("v") ? version.slice(1) : version;

    const repoRoot = await getRepoRoot(process.cwd());
    const artifactsDir = path.isAbsolute(rawArtifactsDir)
      ? rawArtifactsDir
      : path.resolve(repoRoot, rawArtifactsDir);

    const artifacts = [
      { name: "proxer-macos-arm64", os: "mac", arch: "arm" },
      { name: "proxer-macos-x64", os: "mac", arch: "intel" },
      { name: "proxer-linux-x64", os: "linux", arch: "intel" },
      { name: "proxer-linux-arm64", os: "linux", arch: "arm" },
    ];

    const hashes: Record<string, string> = {};

    for (const artifact of artifacts) {
      const filePath = path.join(artifactsDir, artifact.name);
      try {
        hashes[artifact.name] = await calculateSha256(filePath);
      } catch (error) {
        throw new Error(
          `Failed to calculate hash for ${artifact.name} at ${filePath}: ${error}`,
        );
      }
    }

    const generateFormulaContent = (
      className: string,
      isVersioned: boolean,
    ) => {
      const kegOnly = isVersioned ? "\n  keg_only :versioned_formula\n" : "";
      return `class ${className} < Formula
  desc "Reverse tunnel CLI for HTTP, SSE, and WebSocket traffic"
  homepage "https://github.com/tinyrack-net/proxer"
  version "${cleanVersion}"${kegOnly}

  on_macos do
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v${cleanVersion}/proxer-macos-arm64"
      sha256 "${hashes["proxer-macos-arm64"]}"
    end
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v${cleanVersion}/proxer-macos-x64"
      sha256 "${hashes["proxer-macos-x64"]}"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v${cleanVersion}/proxer-linux-x64"
      sha256 "${hashes["proxer-linux-x64"]}"
    end
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v${cleanVersion}/proxer-linux-arm64"
      sha256 "${hashes["proxer-linux-arm64"]}"
    end
  end

  def install
    if OS.mac? && Hardware::CPU.arm?
      bin.install "proxer-macos-arm64" => "proxer"
    elsif OS.mac? && Hardware::CPU.intel?
      bin.install "proxer-macos-x64" => "proxer"
    elsif OS.linux? && Hardware::CPU.intel?
      bin.install "proxer-linux-x64" => "proxer"
    elsif OS.linux? && Hardware::CPU.arm?
      bin.install "proxer-linux-arm64" => "proxer"
    end
  end

  test do
    system "#{bin}/proxer", "--version"
  end
end
`;
    };

    const defaultFormula = generateFormulaContent("Proxer", false);
    const versionClassNameSuffix = cleanVersion.replace(/\./g, "");
    const versionedFormula = generateFormulaContent(
      `ProxerAT${versionClassNameSuffix}`,
      true,
    );

    const outPathDefault = path.join(artifactsDir, "proxer.rb");
    const outPathVersioned = path.join(
      artifactsDir,
      `proxer@${cleanVersion}.rb`,
    );

    await fs.writeFile(outPathDefault, defaultFormula);
    await fs.writeFile(outPathVersioned, versionedFormula);

    console.log(
      `Generated Homebrew formulas: ${outPathDefault}, ${outPathVersioned}`,
    );
  },
  docs: {
    brief: "Generate Homebrew formula",
  },
});

export const homebrewRoute = buildRouteMap({
  routes: {
    generate: generateFormulaCommand,
  },
  docs: {
    brief: "Homebrew commands",
  },
});
