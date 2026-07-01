# cursor-agent-bridge

OpenAI-compatible HTTP bridge for the Cursor Agent CLI.

Use it when you want Codex or another OpenAI-style client to call your local
Cursor Agent CLI through `http://127.0.0.1:4646/v1`. The bridge supports the
Responses API that Codex custom providers use, plus Chat Completions for simpler
clients.

## Requirements

- Node.js 22.13+
- pnpm 11+
- Cursor Agent CLI installed and authenticated

Check Cursor Agent first:

```bash
# Install from https://cursor.com/install, then authenticate the CLI.
agent login
agent --list-models
```

## Install

Install the package globally, then confirm the CLI is on your `PATH`:

```bash
pnpm add -g cursor-agent-bridge
cab --version
```

The package installs two commands. `cab` is the short alias; the full
`cursor-agent-bridge` command stays available for scripts and existing setups.

```bash
cab serve
cab config switch cursor
```

For local development:

```bash
pnpm install
pnpm build
node dist/cli.mjs serve
```

## Upgrade

Check for updates:

```bash
cab upgrade --check
```

Install the latest published version:

```bash
cab upgrade
```

Options:

```bash
cab upgrade --target 0.1.3
cab upgrade --manager npm
```

`--check` compares your installed version with npm and exits `1` when a newer
version is available. The default command installs through pnpm when it manages
the global package, otherwise npm.

If you use the optional macOS LaunchAgent, reinstall it after upgrading so the
service picks up the new binary:

```bash
cab launch-agent install
```

For local development from this repository, use `git pull`, `pnpm install`, and
`pnpm build` instead of `upgrade`.

## Run

Run the bridge in the foreground:

```bash
cab serve --host 127.0.0.1 --port 4646
```

Configuration:

```bash
HOST=127.0.0.1
PORT=4646
CURSOR_AGENT_PATH=agent
CURSOR_AGENT_MAX_CONCURRENT=1
CURSOR_AGENT_YOLO=1
```

By default, the bridge runs Cursor Agent with `--yolo` so Codex can use it as a
non-interactive provider. Set `CURSOR_AGENT_YOLO=0` to keep Cursor Agent's
normal confirmation behavior.

`CURSOR_AGENT_MAX_CONCURRENT` limits concurrent Cursor Agent subprocesses. The
default is `1`.

## macOS Background Service

Codex connects to the configured `base_url`; it does not start provider
processes. On macOS, you can install the optional LaunchAgent to start the
bridge at login and restart it after crashes:

```bash
cab launch-agent install
```

Manage the service:

```bash
cab launch-agent status
cab launch-agent uninstall
```

The LaunchAgent listens on `127.0.0.1:4646` by default. Skip it if you prefer to
run `cab serve` yourself before starting Codex.

## Codex Config

For Codex CLI profile usage, create or update `~/.codex/cursor.config.toml`:

```bash
cab config write
```

Preview the generated profile without writing a file:

```bash
cab config print
```

Validate an existing profile:

```bash
cab config check
```

The generated profile looks like this:

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

Use `/model` in Codex to pick a Cursor model. The model catalog comes from
`agent --list-models`.

## Codex IDE Switching

The Codex IDE extension reads the user-level `~/.codex/config.toml`. Switch
that file when you want the IDE to use Cursor Agent Bridge:

```bash
cab config switch cursor
```

Switch back to Codex's default provider:

```bash
cab config switch openai
```

Check the active provider:

```bash
cab config switch status
```

The switch command backs up the previous `~/.codex/config.toml` to
`~/.codex/config.toml.bak.cursor-agent-bridge` before enabling Cursor. Restore
that backup with:

```bash
cab config switch restore
```

Reload the Codex IDE window or start a new session after switching. Codex does
not reliably hot-reload provider changes while a session is running.

## Troubleshooting

Run a full preflight before starting Codex:

```bash
cab doctor
```

List available Cursor models without starting the HTTP server:

```bash
cab models
cab models --json
```

If `config write` finds a different `model_provider`, pass `--force` to switch
the profile to `cursor`.

## API

```text
GET  /health
GET  /v1/models
POST /v1/responses
POST /v1/chat/completions
```

`GET /v1/models` returns an OpenAI-style model list by default. When Codex calls
the same endpoint, the bridge returns the catalog shape Codex expects for the
model selector.

Model lists are cached briefly so the bridge does not spawn
`agent --list-models` for every request. Pass `refresh=1` to force a refresh.

The bridge accepts sampling and token limit fields such as `temperature`,
`top_p`, `max_tokens`, and `max_output_tokens` for OpenAI client compatibility.
Cursor Agent CLI does not expose stable equivalents for those fields, so the
bridge does not rewrite prompts or add local truncation.

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

Bind the bridge to `127.0.0.1` unless you intentionally expose it on a trusted
network.

The bridge does not forward client `Authorization` headers to Cursor Agent.
Cursor Agent uses local `agent login` state.

## Development

```bash
pnpm install
pnpm run ci
```

GitHub Actions publishes releases from `v*` tags.
