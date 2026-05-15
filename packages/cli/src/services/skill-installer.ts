import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProxerError } from "#app/lib/error.ts";
import { PROXER_SKILL_CONTENT } from "#app/services/proxer-skill-content.ts";

export type SkillInstallOptions = {
  readonly directory: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
};

export type SkillInstallResult = {
  readonly targetPath: string;
  readonly dryRun: boolean;
  readonly overwritten: boolean;
};

const skillFileName = "proxer.md";

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const installProxerSkill = async ({
  directory,
  dryRun = false,
  force = false,
}: SkillInstallOptions): Promise<SkillInstallResult> => {
  const targetPath = path.resolve(directory, skillFileName);

  if (dryRun) {
    return { targetPath, dryRun: true, overwritten: false };
  }

  await mkdir(directory, { recursive: true });

  const overwritten = await fileExists(targetPath);
  if (overwritten && !force) {
    throw new ProxerError(
      `skill already exists: ${targetPath} (use --force to overwrite)`,
    );
  }

  await writeFile(targetPath, PROXER_SKILL_CONTENT, "utf8");

  return { targetPath, dryRun: false, overwritten };
};
