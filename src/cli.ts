#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import packageJson from "../package.json" with { type: "json" }
import { toOpenAIModelList } from "./adapter/models.js"
import { readArg, readHostAndPort } from "./cli-args.js"
import {
  buildCodexConfigToml,
  checkCodexConfig,
  DEFAULT_CODEX_PROFILE,
  resolveCodexConfigPath,
  writeCodexConfig,
} from "./codex-config.js"
import { CursorRunner } from "./cursor/runner.js"
import { formatDoctorReport, runDoctor } from "./doctor.js"
import {
  installLaunchAgent,
  printLaunchAgentStatus,
  uninstallLaunchAgent,
} from "./launch-agent.js"
import { startServer } from "./server.js"
import { runUpgrade } from "./upgrade.js"

const command =
  process.argv[2] && !process.argv[2]?.startsWith("-")
    ? process.argv[2]
    : "serve"

if (
  command === "help" ||
  process.argv.includes("--help") ||
  process.argv.includes("-h")
) {
  console.log(`cursor-agent-bridge

Usage:
  cursor-agent-bridge serve [--host 127.0.0.1] [--port 4646]
  cursor-agent-bridge doctor [--host 127.0.0.1] [--port 4646] [--profile cursor] [--file ~/.codex/cursor.config.toml] [--skip-codex-config]
  cursor-agent-bridge config print [--host 127.0.0.1] [--port 4646] [--profile cursor]
  cursor-agent-bridge config check [--file ~/.codex/cursor.config.toml] [--host 127.0.0.1] [--port 4646] [--profile cursor]
  cursor-agent-bridge config write [--file ~/.codex/cursor.config.toml] [--host 127.0.0.1] [--port 4646] [--profile cursor] [--force]
  cursor-agent-bridge models [--json] [--refresh]
  cursor-agent-bridge launch-agent install [--host 127.0.0.1] [--port 4646] [--agent-path agent]
  cursor-agent-bridge launch-agent uninstall
  cursor-agent-bridge launch-agent status
  cursor-agent-bridge upgrade [--check] [--target latest] [--manager auto|npm|pnpm]

Environment:
  HOST                Listen host, default 127.0.0.1
  PORT                Listen port, default 4646
  CURSOR_AGENT_PATH   Cursor Agent CLI path, default agent
`)
  process.exit(0)
}

if (command === "version" || process.argv.includes("--version")) {
  console.log(packageJson.version)
  process.exit(0)
}

if (command === "upgrade") {
  const checkOnly = process.argv.includes("--check")
  const target = readArg("--target", "latest") ?? "latest"
  const manager = readArg("--manager", "auto") ?? "auto"

  if (manager !== "auto" && manager !== "npm" && manager !== "pnpm") {
    console.error("Invalid --manager value. Use auto, npm, or pnpm.")
    process.exit(1)
  }

  const exitCode = await runUpgrade({
    currentVersion: packageJson.version,
    checkOnly,
    target,
    manager,
  })
  process.exit(exitCode)
}

if (command === "doctor") {
  try {
    const { host, port } = readHostAndPort()
    const profile =
      readArg("--profile", DEFAULT_CODEX_PROFILE) ?? DEFAULT_CODEX_PROFILE
    const codexConfigPath = readArg("--file", undefined)
    const result = await runDoctor({
      host,
      port,
      profile,
      skipCodexConfig: process.argv.includes("--skip-codex-config"),
      ...(process.env.CURSOR_AGENT_PATH
        ? { agentPath: process.env.CURSOR_AGENT_PATH }
        : {}),
      ...(codexConfigPath ? { codexConfigPath } : {}),
    })
    process.stdout.write(formatDoctorReport(result))
    process.exit(result.ok ? 0 : 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (command === "config") {
  const action = process.argv[3] ?? "print"
  try {
    const { host, port } = readHostAndPort()
    const profile =
      readArg("--profile", DEFAULT_CODEX_PROFILE) ?? DEFAULT_CODEX_PROFILE
    const filePath =
      readArg("--file", undefined) ?? resolveCodexConfigPath(profile)

    if (action === "print") {
      process.stdout.write(buildCodexConfigToml({ host, port, profile }))
      console.error(`Start Codex with: codex --profile ${profile}`)
      process.exit(0)
    }

    if (action === "check") {
      const content = await readFile(filePath, "utf8")
      const result = checkCodexConfig(content, { host, port, profile })
      if (result.ok) {
        console.log(`Codex config looks correct: ${filePath}`)
        process.exit(0)
      }

      for (const issue of result.issues) {
        console.error(issue)
      }
      process.exit(1)
    }

    if (action === "write") {
      const result = await writeCodexConfig({
        filePath,
        host,
        port,
        profile,
        force: process.argv.includes("--force"),
      })

      if (result.created) {
        console.log(`Created Codex config at ${result.path}`)
      } else if (result.updated) {
        console.log(`Updated Codex config at ${result.path}`)
      } else {
        console.log(`Codex config already up to date at ${result.path}`)
      }

      console.log(`Start Codex with: codex --profile ${profile}`)
      process.exit(0)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  console.error(`Unknown config action: ${action}`)
  process.exit(1)
}

if (command === "models") {
  try {
    const runner = new CursorRunner({
      ...(process.env.CURSOR_AGENT_PATH
        ? { agentPath: process.env.CURSOR_AGENT_PATH }
        : {}),
    })
    const models = await runner.listModels({
      refresh: process.argv.includes("--refresh"),
    })

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(toOpenAIModelList(models), null, 2))
      process.exit(0)
    }

    for (const model of models) {
      console.log(model.id)
    }
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (command === "launch-agent") {
  const action = process.argv[3] ?? "status"
  try {
    if (action === "install") {
      const { host, port } = readHostAndPort()
      const agentPath = readArg("--agent-path", process.env.CURSOR_AGENT_PATH)
      const paths = installLaunchAgent({
        cliPath: process.argv[1] ?? "cursor-agent-bridge",
        host,
        port,
        ...(agentPath ? { agentPath } : {}),
      })
      console.log(`Installed ${paths.label}`)
      console.log(paths.plistPath)
      process.exit(0)
    }

    if (action === "uninstall") {
      const paths = uninstallLaunchAgent()
      console.log(`Uninstalled ${paths.label}`)
      process.exit(0)
    }

    if (action === "status") {
      process.stdout.write(printLaunchAgentStatus())
      process.exit(0)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  console.error(`Unknown launch-agent action: ${action}`)
  process.exit(1)
}

if (command !== "serve") {
  console.error(`Unknown command: ${command}`)
  process.exit(1)
}

let host: string
let port: number
try {
  const options = readHostAndPort()
  host = options.host
  port = options.port
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const server = await startServer({
  host,
  port,
  ...(process.env.CURSOR_AGENT_PATH
    ? { agentPath: process.env.CURSOR_AGENT_PATH }
    : {}),
})
console.log(`cursor-agent-bridge listening on http://${host}:${port}`)

function shutdown() {
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
