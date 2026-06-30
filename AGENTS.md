# AGENTS.md

This file is the operating contract for agents working in this repository. Keep
it focused on constraints that are easy to miss from source code alone.

## Purpose

`cursor-agent-bridge` exposes the local Cursor Agent CLI as OpenAI-compatible
HTTP endpoints for Codex custom providers and OpenAI-style clients.

## Non-obvious Constraints

- Generate and validate `pnpm-lock.yaml` with `pnpm@11.9.0`, not whatever
  `pnpm` happens to be first on `PATH`. Older pnpm versions can rewrite lockfile
  metadata in a way that passes locally but fails CI with
  `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- Keep `vite` pinned to `8.1.0` in `devDependencies` and `pnpm-workspace.yaml`
  overrides until the supply-chain minimum release age window no longer rejects
  newer releases in CI.
- Keep runtime dependencies minimal. Prefer Node.js standard library unless a
  dependency removes real protocol, stream, or CLI process complexity.
- Do not forward client `Authorization` headers to Cursor Agent by default.
  Cursor auth must come from local `agent login` state or process-level
  `CURSOR_API_KEY`.
- Build the Codex model catalog from `agent --list-models`; do not reintroduce
  hardcoded Cursor model allowlists.
- Bind examples to `127.0.0.1` by default. This bridge is intended for local
  use unless a caller explicitly opts into a wider bind address.
- Preserve TypeScript strict-mode compatibility, including
  `exactOptionalPropertyTypes`.

## Commands

- Install with the CI toolchain:
  `npx --yes pnpm@11.9.0 install --frozen-lockfile`
- Refresh the lockfile, when dependency metadata actually changes:
  `npx --yes pnpm@11.9.0 install --no-frozen-lockfile`
- Run the full local gate: `npx --yes pnpm@11.9.0 run ci`
- Run formatting and lint checks: `pnpm check`
- Apply safe formatting fixes: `pnpm check:fix`
- Run unit tests: `pnpm test`
- Run coverage: `pnpm test:coverage`
- Build: `pnpm build`

Use a Node version accepted by `pnpm@11.9.0`; Node `22.12.0` is too old for that
pnpm release.

## Testing Contract

- Keep global coverage at or above 90% for statements, lines, functions, and
  branches.
- Use fake `agent` scripts in tests instead of requiring a real Cursor account.
- Cover streaming and non-streaming paths when changing `/v1/responses` or
  `/v1/chat/completions` adapters.
- Cover error mapping for invalid client input and Cursor Agent process
  failures.
- For CI or install failures, reproduce with `pnpm@11.9.0` before diagnosing;
  local `pnpm --version` may not match GitHub Actions.

## Release Notes

- CI runs on pushes and pull requests.
- npm publishing runs from `v*` tags via GitHub Actions.
- Publishing requires `NPM_TOKEN` in repository secrets.
- Published package contents are controlled by `package.json` `files`; verify
  with `npm pack --dry-run` before release-related changes.

## When Confused

- Read the failing command literally and align tool versions before changing
  source files.
- If a rule here becomes enforceable by config, tests, or CI, prefer automating
  it and then shorten this file.
- Do not copy general project explanation from `README.md` into this file unless
  it changes how an agent should edit, test, or release the project.
