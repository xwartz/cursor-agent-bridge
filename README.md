# cursor-agent-bridge

Responses-compatible API bridge for the Cursor Agent CLI.

`cursor-agent-bridge` lets Codex and OpenAI-compatible clients use your local Cursor Agent CLI session through a localhost API. It is designed around Codex's current custom-provider requirement for the Responses API while still exposing Chat Completions for simpler clients.

## Requirements

- Node.js 20+
- pnpm 11+
- Cursor Agent CLI installed and authenticated

Install Cursor Agent and verify it first:

```bash
agent login
agent --list-models
```

## Install

```bash
pnpm add -g cursor-agent-bridge
```

During local development:

```bash
pnpm install
pnpm build
pnpm exec cursor-agent-bridge serve
```

## Run

```bash
cursor-agent-bridge serve --host 127.0.0.1 --port 4646
```

Environment variables:

```bash
HOST=127.0.0.1
PORT=4646
CURSOR_AGENT_PATH=agent
```

## Codex Config

Add a Codex profile such as `~/.codex/cursor.config.toml`:

```toml
model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
```

Start Codex:

```bash
codex --profile cursor
```

Use `/model` to select a Cursor model. The model catalog is generated from `agent --list-models`.

## API

```text
GET  /health
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

`GET /v1/models` returns the OpenAI-compatible list by default. When Codex calls it with `client_version`, it returns the Codex model catalog shape expected by `/model`.

## Examples

Responses API:

```bash
curl -sS http://127.0.0.1:4646/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","input":"Reply OK","stream":false}'
```

Chat Completions:

```bash
curl -sS http://127.0.0.1:4646/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Reply OK"}],"stream":false}'
```

## Security Notes

This server is intended for local use. Bind to `127.0.0.1` unless you are deliberately exposing it on a trusted network.

Client `Authorization` headers are not forwarded to Cursor Agent. Use Cursor Agent login or `CURSOR_API_KEY` in the bridge process environment.

## Development

```bash
pnpm install
pnpm run ci
```

Release publishing is handled by GitHub Actions on tags named `v*`.
The publish workflow uses npm Trusted Publishing with GitHub OIDC, so it does
not require an `NPM_TOKEN` repository secret.
