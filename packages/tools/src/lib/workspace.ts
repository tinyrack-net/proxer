import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function findRepoRoot(cwd: string): Promise<string> {
  let current = cwd;

  while (true) {
    if (await isRepoRoot(current)) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`Could not find pnpm workspace root from ${cwd}`);
    }

    current = parent;
  }
}

const isRepoRoot = async (directory: string): Promise<boolean> => {
  return (
    (await pathExists(join(directory, "pnpm-workspace.yaml"))) &&
    (await pathExists(join(directory, "packages", "cli", "package.json")))
  );
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
