# Proxer

## Project Overview

**Proxer** is a Dart CLI project for reverse-tunnel workflows.

- **Main Technologies:** Dart (>=3.12), cliweave, package:test.
- **Architecture:** A Dart workspace with packages in `packages/cli` and `packages/tools`. The standalone React Router homepage lives in `homepage`.

## Mandatory Validation Loop

Run the validation loop after changes:

- **All Dart checks:** `dart run packages/tools/bin/cli.dart validate`
- **Homepage:** `pnpm run validate` from `homepage`

## Workspace Structure

- `packages/cli`: The Proxer native CLI.
- `packages/tools`: Dart release, packaging, and validation tooling.
- `homepage`: React Router documentation site.

## CLI Development

- Keep command definitions and output in `lib/src/cli`.
- Keep tunnel orchestration in `lib/src/services`.
- Preserve the protocol frame contract and command output compatibility.
- Unit and integration tests live under `packages/cli/test`.
