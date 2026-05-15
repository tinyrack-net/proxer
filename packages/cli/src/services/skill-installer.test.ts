import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installProxerSkill } from "#app/services/skill-installer.ts";

const createTempDirectory = async (): Promise<string> => {
  return await mkdtemp(path.join(tmpdir(), "proxer-skill-"));
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

describe("skill installer", () => {
  it("installs proxer.md into a new directory", async () => {
    const directory = path.join(await createTempDirectory(), "skills");

    const result = await installProxerSkill({ directory });
    const content = await readFile(path.join(directory, "proxer.md"), "utf8");

    expect(result).toEqual({
      targetPath: path.resolve(directory, "proxer.md"),
      dryRun: false,
      overwritten: false,
    });
    expect(content).toContain("proxer skill");
    expect(content).toContain("proxer server");
    expect(content).toContain("proxer http");
    expect(content).toContain("/__proxer__/control");
  });

  it("refuses to overwrite without force", async () => {
    const directory = await createTempDirectory();
    const targetPath = path.join(directory, "proxer.md");
    await writeFile(targetPath, "existing skill\n", "utf8");

    await expect(installProxerSkill({ directory })).rejects.toThrow(
      "skill already exists",
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "existing skill\n",
    );
  });

  it("overwrites with force", async () => {
    const directory = await createTempDirectory();
    const targetPath = path.join(directory, "proxer.md");
    await writeFile(targetPath, "stale skill\n", "utf8");

    const result = await installProxerSkill({ directory, force: true });
    const content = await readFile(targetPath, "utf8");

    expect(result.overwritten).toBe(true);
    expect(content).not.toBe("stale skill\n");
    expect(content).toContain("proxer skill");
  });

  it("dry run does not create directory or file", async () => {
    const directory = path.join(
      await createTempDirectory(),
      "nested",
      "skills",
    );

    const result = await installProxerSkill({ directory, dryRun: true });

    expect(result.targetPath).toBe(path.resolve(directory, "proxer.md"));
    expect(result.dryRun).toBe(true);
    expect(await pathExists(directory)).toBe(false);
    expect(await pathExists(result.targetPath)).toBe(false);
  });
});
