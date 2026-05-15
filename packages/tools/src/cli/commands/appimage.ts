import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { execa } from "execa";
import { getRepoRoot } from "../../lib/git.ts";

const buildAppImageCommand = buildCommand<
  { executablePath: string; outputPath: string; arch: string },
  []
>({
  parameters: {
    flags: {
      executablePath: {
        kind: "parsed",
        brief: "Path to the executable to wrap in AppImage",
        parse: String,
      },
      outputPath: {
        kind: "parsed",
        brief: "Path where the AppImage should be written",
        parse: String,
      },
      arch: {
        kind: "parsed",
        brief: "Architecture (x86_64, aarch64)",
        parse: String,
      },
    },
  },
  docs: {
    brief: "Build AppImage for Linux",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    const appDir = join(repoRoot, "AppDir");
    const binPath = join(repoRoot, flags.executablePath);
    const appImageToolPath = join(repoRoot, "appimagetool");
    const artifactPath = join(repoRoot, flags.outputPath);

    await rm(appDir, { force: true, recursive: true });
    await mkdir(join(appDir, "usr/bin"), { recursive: true });
    await copyFile(binPath, join(appDir, "usr/bin/proxer"));
    await chmod(join(appDir, "usr/bin/proxer"), 0o755);

    await writeFile(
      join(appDir, "proxer.desktop"),
      `[Desktop Entry]
Name=Proxer
Exec=proxer %F
Icon=proxer
Type=Application
Categories=Utility;
Terminal=true
`,
    );

    await writeFile(
      join(appDir, "proxer.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#111827"/>
  <path d="M36 44h32a20 20 0 0 1 0 40H52" fill="none" stroke="#38bdf8" stroke-width="12" stroke-linecap="round"/>
  <path d="M92 84H60a20 20 0 0 1 0-40h16" fill="none" stroke="#a78bfa" stroke-width="12" stroke-linecap="round"/>
</svg>
`,
    );

    await writeFile(
      join(appDir, "AppRun"),
      `#!/bin/sh
HERE="$(dirname "$(readlink -f "\${0}")")"
export PATH="\${HERE}/usr/bin:\${PATH}"
exec proxer "$@"
`,
    );
    await chmod(join(appDir, "AppRun"), 0o755);

    const appImageToolName = `appimagetool-${flags.arch}.AppImage`;
    const appImageToolUrl = `https://github.com/AppImage/AppImageKit/releases/download/continuous/${appImageToolName}`;

    console.log(`Downloading ${appImageToolName}...`);
    await execa("wget", [appImageToolUrl, "-O", appImageToolPath]);
    await chmod(appImageToolPath, 0o755);

    console.log("Building AppImage...");
    await execa(
      appImageToolPath,
      ["--appimage-extract-and-run", appDir, artifactPath],
      {
        env: { ARCH: flags.arch },
        cwd: repoRoot,
      },
    );
  },
});

export const appimageRoute = buildRouteMap({
  routes: {
    build: buildAppImageCommand,
  },
  docs: {
    brief: "AppImage commands",
  },
});
