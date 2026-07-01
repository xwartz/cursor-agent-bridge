# AGENTS.md

This is the working guide for agents editing this repository. Keep it short,
specific, and limited to rules that are easy to miss from the code.

## Purpose

`cursor-agent-bridge` exposes the local Cursor Agent CLI as OpenAI-compatible
HTTP endpoints for Codex custom providers and OpenAI-style clients.

## Do

- Use `pnpm@11.9.0` for lockfile work. Older pnpm versions can rewrite
  metadata that passes locally but fails CI with
  `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- Keep runtime dependencies small. Use Node.js standard library unless a
  package removes real protocol, stream, or subprocess complexity.
- Read the `/health` version from `package.json`. Do not hardcode package
  versions in source files.
- Build the Codex model catalog from `agent --list-models`.
- Bind examples and local services to `127.0.0.1` by default.
- Keep macOS LaunchAgent support optional. Codex connects to `base_url`; it does
  not require this package to manage the background process.
- Preserve TypeScript strict-mode compatibility, including
  `exactOptionalPropertyTypes`.

## Don't

- Do not forward client `Authorization` headers to Cursor Agent by default.
  Cursor auth comes from local `agent login` state.
- Do not add hardcoded Cursor model allowlists.
- Do not make LaunchAgent installation part of the normal CLI or library path.
- Do not edit `pnpm-lock.yaml` with whatever `pnpm` appears first on `PATH`.
- Do not copy README material here unless it changes how an agent should edit,
  test, or release the project.

## Commands

- Install with the CI toolchain:
  `npx --yes pnpm@11.9.0 install --frozen-lockfile`
- Refresh the lockfile after dependency metadata changes:
  `npx --yes pnpm@11.9.0 install --no-frozen-lockfile`
- Run the full local gate: `npx --yes pnpm@11.9.0 run ci`
- Check formatting and lint: `pnpm check`
- Apply safe formatting fixes: `pnpm check:fix`
- Run all tests: `pnpm test`
- Run one test file: `pnpm test -- test/server.test.ts`
- Run coverage: `pnpm test:coverage`
- Build: `pnpm build`
- Check package contents: `npm pack --dry-run`
- Install the optional macOS service:
  `cursor-agent-bridge launch-agent install`
- Inspect the optional macOS service:
  `cursor-agent-bridge launch-agent status`

Use a Node version accepted by `pnpm@11.9.0`; Node `22.12.0` is too old for that
pnpm release.

## Testing Contract

- Keep global coverage at or above 90% for statements, lines, functions, and
  branches.
- Use fake `agent` scripts in tests. Tests must not require a real Cursor
  account.
- Cover streaming and non-streaming paths when changing `/v1/responses` or
  `/v1/chat/completions`.
- Cover invalid client input and Cursor Agent process failures.
- Cover LaunchAgent changes with mocks. Tests must not call the real
  `launchctl`.
- Reproduce CI or install failures with `pnpm@11.9.0` before diagnosing them.

## Release Checklist

- Keep `package.json` `version` aligned with the tag.
- Keep `package.json` `repository.url` equal to
  `https://github.com/xwartz/cursor-agent-bridge`; npm provenance checks it
  against the GitHub OIDC repository.
- Run `npx --yes pnpm@11.9.0 run ci`.
- Run `npm pack --dry-run` before release-related changes.
- Publish from `v*` tags through GitHub Actions.
- Keep `id-token: write` in `.github/workflows/publish.yml` for npm Trusted
  Publishing.

## When Stuck

- Read the failing command literally and align tool versions before changing
  source files.
- If an install failure mentions supply-chain policy or lockfile config, verify
  `pnpm@11.9.0` first.
- If publish fails during provenance validation, inspect package metadata before
  changing GitHub Actions.
- If a rule here can move into config, tests, or CI, automate it and shorten
  this file.
