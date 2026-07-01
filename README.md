# cursor-agent-bridge

OpenAI-compatible HTTP bridge for the Cursor Agent CLI.

`cursor-agent-bridge` lets Codex and other OpenAI-compatible clients talk to a
local Cursor Agent session through `http://127.0.0.1:4646/v1`. It supports the
Responses API used by Codex custom providers and a Chat Completions endpoint for
simpler clients.

## Requirements

- Node.js 20+
- pnpm 11+
- Cursor Agent CLI installed and authenticated

Verify Cursor Agent before starting the bridge:

```bash
agent login
agent --list-models
```

## Install

```bash
pnpm add -g cursor-agent-bridge
```

For local development:

```bash
pnpm install
pnpm build
pnpm exec cursor-agent-bridge serve
```

## Run

Start the bridge in the foreground:

```bash
cursor-agent-bridge serve --host 127.0.0.1 --port 4646
```

Environment variables:

```bash
HOST=127.0.0.1
PORT=4646
CURSOR_AGENT_PATH=agent
```

## macOS Background Service

Codex connects to the configured `base_url`; it does not start provider
processes. On macOS, install the optional LaunchAgent if you want the bridge to
start at login and restart after crashes:

```bash
cursor-agent-bridge launch-agent install
```

Manage the service:

```bash
cursor-agent-bridge launch-agent status
cursor-agent-bridge launch-agent uninstall
```

The LaunchAgent listens on `127.0.0.1:4646` by default. Skip this step if you
prefer to run `cursor-agent-bridge serve` manually before starting Codex.

## Codex Config

Create `~/.codex/cursor.config.toml`:

```toml
model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
```

Start Codex with the profile:

```bash
codex --profile cursor
```

Use `/model` inside Codex to pick a Cursor model. The model catalog comes from
`agent --list-models`.

## API

```text
GET  /health
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

`GET /v1/models` returns an OpenAI-style model list by default. Codex calls the
same endpoint with `client_version`, and the bridge returns the catalog shape
Codex expects for `/model`.

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

## Security

Run the bridge on `127.0.0.1` unless you intentionally expose it on a trusted
network.

The bridge does not forward client `Authorization` headers to Cursor Agent. Use
Cursor Agent login, or set `CURSOR_API_KEY` in the bridge process environment.

## Development

```bash
pnpm install
pnpm run ci
```

Releases are published by GitHub Actions from `v*` tags. Publishing uses npm
Trusted Publishing with GitHub OIDC and does not require an `NPM_TOKEN`
repository secret.
