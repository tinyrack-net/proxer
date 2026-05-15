# Proxer

## Project Overview

**Proxer** is a Node.js CLI project for reverse-tunnel workflows.

- **Main Technologies:** Node.js (>=24), TypeScript, pnpm (Monorepo), Vitest, Biome.
- **Architecture:** A pnpm workspace with the CLI package in `packages/cli`.

## Mandatory Validation Loop

Run the validation loop after changes:

- **Build:** `pnpm run build`
- **Typecheck:** `pnpm run typecheck`
- **Test:** `pnpm run test`
- **Lint/Format Check:** `pnpm run format:check`

## Workspace Structure

- `packages/cli`: The `@tinyrack/proxer` CLI package.

## CLI Development

- Use `#app/*` imports for internal CLI source imports.
- Keep the tunnel implementation minimal until product behavior is specified.
- Unit tests live beside source files as `src/**/*.test.ts`.
