import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");

const readRepoFile = (relativePath: string): Promise<string> => {
  return readFile(resolve(repoRoot, relativePath), "utf8");
};

describe("Docker distribution metadata", () => {
  test("Dockerfile builds the pkg Linux binary and runs proxer by default", async () => {
    const dockerfile = await readRepoFile("Dockerfile");

    expect(dockerfile).toContain("COPY packages/tools/src packages/tools/src");
    expect(dockerfile).toContain(
      "pnpm --filter @tinyrack/proxer run pkg:build",
    );
    expect(dockerfile).toContain("node24-linux-${pkg_arch}");
    expect(dockerfile).toContain("/tmp/proxer /usr/local/bin/proxer");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/proxer"]');
  });

  test("dockerignore excludes local, generated, and secret-bearing files", async () => {
    const dockerignore = await readRepoFile(".dockerignore");

    for (const ignoredPath of [
      ".env",
      ".env.*",
      ".git",
      ".hermes",
      ".opencode",
      "coverage",
      "dist",
      "node_modules",
    ]) {
      expect(dockerignore).toContain(ignoredPath);
    }
  });

  test("workflow builds pull request smoke images and publishes GHCR tags", async () => {
    const workflow = await readRepoFile(".github/workflows/pipeline.yml");

    expect(workflow).toContain("ghcr.io/tinyrack-net/proxer");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("docker/login-action");
    expect(workflow).toContain("docker/metadata-action");
    expect(workflow).toContain("docker/build-push-action");
    expect(workflow).toContain("type=semver,pattern={{version}}");
    expect(workflow).toContain("type=raw,value=latest");
    expect(workflow).toContain("type=raw,value=edge");
    expect(workflow).toContain("docker run --rm proxer:ci --version");
  });

  test("README documents Docker install and runtime examples", async () => {
    const readme = await readRepoFile("README.md");

    expect(readme).toContain(
      "docker run --rm ghcr.io/tinyrack-net/proxer --version",
    );
    expect(readme).toContain(
      "docker run --rm -p 8080:8080 ghcr.io/tinyrack-net/proxer server",
    );
    expect(readme).toContain("--network host");
    expect(readme).toContain("host.docker.internal");
  });
});
