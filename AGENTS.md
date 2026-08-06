# Proxer

## Project Overview

**Proxer** is a Dart CLI project for reverse-tunnel workflows.

- **Main Technologies:** Dart (>=3.12), cliweave, shipworld, package:test.
- **Architecture:** A single-package Dart CLI rooted at the repository (`bin`, `lib`, `test`, `tool`). Release and packaging are driven by `shipworld` via `shipworld.yaml`. The standalone React Router homepage lives in `homepage`.
- **Dependencies:** `cliweave` and `shipworld` come from a pinned commit of `tinyrack-net/dart-packages`, not pub.dev. Both must stay on the same SHA, and bumping it means editing three places in `pubspec.yaml`: `dependencies`, `dev_dependencies`, and the `dependency_overrides` entry that keeps `cliweave` on the git source.

## Mandatory Validation Loop

Run the validation loop after changes:

- **All Dart checks:** `dart run tool/validate.dart`
- **Homepage:** `pnpm run validate` from `homepage`

## Project Structure

- `bin`, `lib`: The Proxer native CLI.
- `tool`: `validate.dart`, `smoke.dart`, and `build_e2e.dart`, built on shipworld primitives.
- `shipworld.yaml`: Release, signing, and packaging configuration (MSIX, AppImage, Homebrew, macOS signing).
- `homepage`: React Router documentation site.

## Merging

- `main` is protected and takes no direct pushes, admins included. Every change lands through a pull request.
- The one required check is `Quality Gate`, an aggregate job in `.github/workflows/pipeline.yml` that fails unless every quality job reports `success`. A job it needs that reports `skipped` fails the gate too, so anything added to `needs` has to run on both `pull_request` and `merge_group`.
- `gh pr merge --auto --squash <number>` queues the merge. Once the checks pass, the merge queue re-runs the pipeline on the pull request rebased onto current `main`, then squash-merges and deletes the branch.

## Release

- Version is single-sourced in `pubspec.yaml` and synchronized into `lib/src/util/version.g.dart` by shipworld.
- Bump/commit/tag manually: `dart run shipworld:shipworld release prepare proxer=<patch|minor|major>` then `dart run shipworld:shipworld release finalize proxer --push`.

## CLI Development

- Keep command definitions and output in `lib/src/cli`.
- Keep tunnel orchestration in `lib/src/services`.
- Preserve the protocol frame contract and command output compatibility.
- Unit and integration tests live under `test`.
