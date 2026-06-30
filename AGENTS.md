# AGENTS.md

## Project

`cursor-agent-bridge` is a local Node.js bridge that exposes Cursor Agent CLI through OpenAI-compatible HTTP endpoints, with first-class support for Codex custom providers.

## Commands

- Install dependencies with `pnpm install`.
- Run the full verification suite with `pnpm run ci`.
- Run formatting and lint checks with `pnpm check`.
- Apply safe formatting fixes with `pnpm check:fix`.
- Run unit tests with `pnpm test`.
- Run coverage with `pnpm test:coverage`.
- Build with `pnpm build`.

## Engineering Rules

- Use TypeScript strict mode and keep `exactOptionalPropertyTypes` compatibility.
- Keep runtime dependencies minimal; prefer Node.js standard library unless a dependency removes real protocol or CLI complexity.
- Do not forward client `Authorization` headers to Cursor Agent by default. Cursor auth must come from the local `agent login` state or process-level `CURSOR_API_KEY`.
- Keep `/v1/responses` compatible with Codex's Responses API subset and `/v1/chat/completions` compatible with OpenAI-style clients.
- Build the Codex model catalog from `agent --list-models`; do not reintroduce hardcoded Cursor model allowlists.
- Bind examples to `127.0.0.1` by default. This project is intended for local use.

## Testing Expectations

- Keep global coverage at or above 90% for statements, lines, functions, and branches.
- Use fake `agent` scripts in tests instead of requiring a real Cursor account.
- Cover both streaming and non-streaming paths for Responses and Chat Completions when changing protocol adapters.
- Cover error mapping for invalid client input and Cursor Agent process failures.

## Release

- CI runs on pushes and pull requests.
- npm publishing runs from `v*` tags via GitHub Actions.
- The publish workflow requires `NPM_TOKEN` in repository secrets.
