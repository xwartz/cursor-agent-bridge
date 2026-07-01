# AGENTS.md

This file is the operating contract for agents working in this repository. Keep
it focused on concrete rules that are easy to miss from source code alone.

## Purpose

`cursor-agent-bridge` exposes the local Cursor Agent CLI as OpenAI-compatible
HTTP endpoints for Codex custom providers and OpenAI-style clients.

## Do

- Use `pnpm@11.9.0` when generating or validating `pnpm-lock.yaml`. Older pnpm
  versions can rewrite lockfile metadata in a way that passes locally but fails
  CI with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- Keep runtime dependencies minimal. Prefer Node.js standard library unless a
  dependency removes real protocol, stream, or CLI process complexity.
- Keep `/health` version sourced from `package.json`; do not hardcode package
  versions in source files.
- Build the Codex model catalog from `agent --list-models`.
- Bind examples and local services to `127.0.0.1` by default.
- Keep macOS LaunchAgent support optional. Codex does not start provider
  processes, so LaunchAgent is for convenience, not a runtime requirement.
- Preserve TypeScript strict-mode compatibility, including
  `exactOptionalPropertyTypes`.

## Don't

- Do not forward client `Authorization` headers to Cursor Agent by default.
  Cursor auth must come from local `agent login` state or process-level
  `CURSOR_API_KEY`.
- Do not reintroduce hardcoded Cursor model allowlists.
- Do not make LaunchAgent installation required for CLI or library usage.
- Do not add `NPM_TOKEN` to publishing. The project uses npm Trusted Publishing
  with GitHub OIDC.
- Do not edit `pnpm-lock.yaml` with whatever `pnpm` is first on `PATH`.
- Do not copy general README explanations into this file unless they change how
  an agent should edit, test, or release the project.

## Project Map

- `src/cli.ts`: CLI entrypoint, command parsing, `serve` and `launch-agent`
  subcommands.
- `src/server.ts`: HTTP server, CORS, `/health`, `/v1/models`,
  `/v1/responses`, and `/v1/chat/completions`.
- `src/launch-agent.ts`: macOS LaunchAgent plist generation and
  install/status/uninstall helpers.
- `src/adapter/messages.ts`: OpenAI/Codex message normalization and prompt
  construction.
- `src/adapter/models.ts`: Cursor model list parsing and OpenAI/Codex model
  catalog conversion.
- `src/adapter/openai.ts`: OpenAI-compatible response and streaming payload
  builders.
- `src/cursor/runner.ts`: Cursor Agent subprocess execution and output parsing.
- `test/*.test.ts`: Vitest coverage for adapters, server behavior, runner
  behavior, package metadata, and LaunchAgent helpers.

## Commands

- Install with the CI toolchain:
  `npx --yes pnpm@11.9.0 install --frozen-lockfile`
- Refresh the lockfile, when dependency metadata actually changes:
  `npx --yes pnpm@11.9.0 install --no-frozen-lockfile`
- Run the full local gate: `npx --yes pnpm@11.9.0 run ci`
- Run formatting and lint checks: `pnpm check`
- Apply safe formatting fixes: `pnpm check:fix`
- Run all tests: `pnpm test`
- Run one test file: `pnpm test -- test/server.test.ts`
- Run coverage: `pnpm test:coverage`
- Build: `pnpm build`
- Check package contents: `npm pack --dry-run`
- Install the optional macOS background service:
  `cursor-agent-bridge launch-agent install`
- Inspect the optional macOS background service:
  `cursor-agent-bridge launch-agent status`

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
- Cover LaunchAgent changes with mocks; tests must not call the real
  `launchctl`.
- For CI or install failures, reproduce with `pnpm@11.9.0` before diagnosing;
  local `pnpm --version` may not match GitHub Actions.

## Release Checklist

- Keep `package.json` `version` aligned with the tag being pushed.
- Keep `package.json` `repository.url` equal to
  `https://github.com/xwartz/cursor-agent-bridge`; npm provenance validates it
  against the GitHub OIDC repository.
- Run `npx --yes pnpm@11.9.0 run ci`.
- Run `npm pack --dry-run` before release-related changes.
- npm publishing runs from `v*` tags via GitHub Actions.
- Publishing uses npm Trusted Publishing with GitHub OIDC. Keep `id-token:
  write` in `.github/workflows/publish.yml`.

## When Stuck

- Read the failing command literally and align tool versions before changing
  source files.
- If an install failure mentions supply-chain policy or lockfile config, verify
  `pnpm@11.9.0` first.
- If publish fails during provenance validation, inspect package metadata before
  changing GitHub Actions.
- If a rule here becomes enforceable by config, tests, or CI, prefer automating
  it and then shorten this file.
