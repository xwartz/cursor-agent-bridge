import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import packageJson from "../package.json" with { type: "json" }
import { createFakeAgent } from "./helpers.js"

const execFileAsync = promisify(execFile)
const unrunBin = "node_modules/.bin/unrun"

async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  try {
    const result = await execFileAsync(unrunBin, ["src/cli.ts", ...args], {
      env,
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const execError = error as {
      code?: number
      stdout?: string
      stderr?: string
    }
    return {
      code: execError.code ?? 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    }
  }
}

describe("CLI", () => {
  it("prints help with exit code 0", async () => {
    const result = await runCli(["--help"])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("cursor-agent-bridge serve")
    expect(result.stdout).toContain("cursor-agent-bridge upgrade")
    expect(result.stdout).toContain("cursor-agent-bridge doctor")
    expect(result.stdout).toContain("cursor-agent-bridge config write")
    expect(result.stdout).toContain("cursor-agent-bridge config switch")
    expect(result.stdout).toContain("cursor-agent-bridge models")
  })

  it("prints the package version with exit code 0", async () => {
    const result = await runCli(["--version"])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(packageJson.version)
  })

  it("rejects invalid serve ports with exit code 1", async () => {
    const result = await runCli(["serve", "--port", "nope"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Invalid port: nope")
  })

  it("rejects missing serve port values with exit code 1", async () => {
    const result = await runCli(["serve", "--port"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Missing value for --port")
  })

  it("rejects invalid LaunchAgent ports with exit code 1 before touching launchctl", async () => {
    const result = await runCli(["launch-agent", "install", "--port", "0"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Invalid port: 0")
  })

  it("rejects unknown commands with exit code 1", async () => {
    const result = await runCli(["missing-command"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Unknown command: missing-command")
  })

  it("rejects invalid upgrade manager values with exit code 1", async () => {
    const result = await runCli(["upgrade", "--manager", "yarn"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Invalid --manager value")
  })

  it("prints Codex config with config print", async () => {
    const result = await runCli(["config", "print"])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('model_provider = "cursor"')
    expect(result.stdout).toContain('base_url = "http://127.0.0.1:4646/v1"')
    expect(result.stdout).not.toContain("codex --profile cursor")
    expect(result.stderr).toContain("codex --profile cursor")
  })

  it("rejects invalid Codex profile names", async () => {
    const result = await runCli([
      "config",
      "print",
      "--profile",
      "../../../../tmp/pwn",
    ])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Invalid Codex profile")
  })

  it("writes Codex config with config write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-config-"))
    const filePath = join(dir, "cursor.config.toml")

    const result = await runCli([
      "config",
      "write",
      "--file",
      filePath,
      "--host",
      "127.0.0.1",
      "--port",
      "4646",
    ])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`Created Codex config at ${filePath}`)
    expect(await readFile(filePath, "utf8")).toContain(
      'base_url = "http://127.0.0.1:4646/v1"',
    )
  })

  it("checks Codex config with config check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
`,
      "utf8",
    )

    const result = await runCli(["config", "check", "--file", filePath])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Codex config looks correct")
  })

  it("requires force before config write switches another provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "auto"
`,
      "utf8",
    )

    const rejected = await runCli(["config", "write", "--file", filePath])

    expect(rejected.code).toBe(1)
    expect(rejected.stderr).toContain("Re-run with --force")

    const accepted = await runCli([
      "config",
      "write",
      "--file",
      filePath,
      "--force",
    ])

    expect(accepted.code).toBe(0)
    expect(accepted.stdout).toContain(`Updated Codex config at ${filePath}`)
    expect(await readFile(filePath, "utf8")).toContain(
      'model_provider = "cursor"',
    )
  })

  it("switches Codex user config between cursor and openai", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "gpt-5.5"
`,
      "utf8",
    )

    const cursor = await runCli([
      "config",
      "switch",
      "cursor",
      "--file",
      filePath,
    ])

    expect(cursor.code).toBe(0)
    expect(cursor.stdout).toContain(
      `Switched Codex config to cursor: ${filePath}`,
    )
    expect(cursor.stdout).toContain("Reload Codex IDE")
    expect(await readFile(filePath, "utf8")).toContain(
      'model_provider = "cursor"',
    )

    const openai = await runCli([
      "config",
      "switch",
      "openai",
      "--file",
      filePath,
    ])

    expect(openai.code).toBe(0)
    expect(openai.stdout).toContain(
      `Switched Codex config to openai: ${filePath}`,
    )
    expect(await readFile(filePath, "utf8")).toContain('model = "gpt-5.5"')
  })

  it("prints Codex switch status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(filePath, 'model_provider = "cursor"\n', "utf8")

    const result = await runCli([
      "config",
      "switch",
      "status",
      "--file",
      filePath,
    ])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`Codex config: ${filePath}`)
    expect(result.stdout).toContain("Current model_provider: cursor")
  })

  it("restores Codex switch backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cli-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(filePath, 'model_provider = "openai"\n', "utf8")
    await runCli(["config", "switch", "cursor", "--file", filePath])

    const result = await runCli([
      "config",
      "switch",
      "restore",
      "--file",
      filePath,
    ])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Restored Codex config")
    expect(await readFile(filePath, "utf8")).toBe('model_provider = "openai"\n')
  })

  it("rejects unknown Codex switch targets", async () => {
    const result = await runCli(["config", "switch", "missing"])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Unknown config switch target")
  })

  it("lists models through the CLI", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
`)

    const result = await runCli(["models"], {
      ...process.env,
      CURSOR_AGENT_PATH: agentPath,
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("auto")
  }, 15_000)
})
