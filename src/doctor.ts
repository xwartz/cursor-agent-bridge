import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import packageJson from "../package.json" with { type: "json" }
import {
  checkCodexConfig,
  DEFAULT_CODEX_PROFILE,
  resolveCodexConfigPath,
} from "./codex-config.js"
import { CursorRunner } from "./cursor/runner.js"

const execFileAsync = promisify(execFile)

export type DoctorCheck = {
  name: string
  ok: boolean
  message: string
  hint?: string
}

export type ExecFileFn = (
  file: string,
  args?: readonly string[] | null,
  options?: { timeout?: number },
) => Promise<unknown>

export type DoctorOptions = {
  host: string
  port: number
  agentPath?: string
  profile?: string
  nodeVersionRange?: string
  codexConfigPath?: string
  skipCodexConfig?: boolean
  runner?: CursorRunner
  fetchFn?: typeof fetch
  execFileFn?: ExecFileFn
  readFileFn?: typeof readFile
}

export async function runDoctor(options: DoctorOptions) {
  const checks: DoctorCheck[] = []
  const fetchFn = options.fetchFn ?? fetch
  const execFileFn = options.execFileFn ?? execFileAsync
  const readFileFn = options.readFileFn ?? readFile
  const agentPath =
    options.agentPath ?? process.env.CURSOR_AGENT_PATH ?? "agent"
  const profile = options.profile ?? DEFAULT_CODEX_PROFILE
  const codexConfigPath =
    options.codexConfigPath ?? resolveCodexConfigPath(profile)

  checks.push(
    checkNodeVersion(options.nodeVersionRange ?? packageJson.engines.node),
  )
  checks.push({
    name: "bridge-version",
    ok: true,
    message: `cursor-agent-bridge ${packageJson.version}`,
  })

  const agentCheck = await checkAgentExecutable(agentPath, execFileFn)
  checks.push(agentCheck)

  if (agentCheck.ok) {
    checks.push(await checkAgentLogin(agentPath, options.runner))
  }

  checks.push(await checkBridgeHealth(options.host, options.port, fetchFn))

  if (!options.skipCodexConfig) {
    checks.push(
      await checkCodexConfigFile({
        codexConfigPath,
        host: options.host,
        port: options.port,
        profile,
        readFileFn,
      }),
    )
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  }
}

export function formatDoctorReport(result: {
  ok: boolean
  checks: DoctorCheck[]
}) {
  const lines = result.checks.map((check) => {
    const prefix = check.ok ? "✓" : "✗"
    const hint = check.hint ? `\n  → ${check.hint}` : ""
    return `${prefix} ${check.name}: ${check.message}${hint}`
  })

  lines.push("")
  lines.push(
    result.ok
      ? "All checks passed. Codex can use Cursor Agent through the bridge."
      : "Some checks failed. Fix the items above before starting Codex.",
  )

  return `${lines.join("\n")}\n`
}

function checkNodeVersion(requiredRange: string): DoctorCheck {
  const current = process.version.slice(1)
  const minimum = parseMinimumNodeVersion(requiredRange)
  const ok = compareNodeVersion(current, minimum) >= 0

  return ok
    ? {
        name: "node-version",
        ok,
        message: `Node ${current} satisfies ${requiredRange}`,
      }
    : {
        name: "node-version",
        ok,
        message: `Node ${current} does not satisfy ${requiredRange}`,
        hint: `Install Node ${minimum} or newer.`,
      }
}

async function checkAgentExecutable(
  agentPath: string,
  execFileFn: ExecFileFn,
): Promise<DoctorCheck> {
  try {
    await execFileFn(agentPath, ["--help"], { timeout: 5_000 })
    return {
      name: "agent-cli",
      ok: true,
      message: `Cursor Agent CLI found at ${agentPath}`,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cursor Agent CLI not found"
    return {
      name: "agent-cli",
      ok: false,
      message,
      hint: "Install the Cursor Agent CLI and ensure `agent` is on PATH, or set CURSOR_AGENT_PATH.",
    }
  }
}

async function checkAgentLogin(
  agentPath: string,
  runner = new CursorRunner({ agentPath }),
): Promise<DoctorCheck> {
  try {
    const models = await runner.listModels({
      refresh: true,
    })
    if (models.length === 0) {
      return {
        name: "agent-login",
        ok: false,
        message: "Cursor Agent responded, but returned no models",
        hint: "Run `agent login` and confirm `agent --list-models` returns models.",
      }
    }

    return {
      name: "agent-login",
      ok: true,
      message: `Cursor Agent is logged in (${models.length} models available)`,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cursor Agent login check failed"
    return {
      name: "agent-login",
      ok: false,
      message,
      hint: "Run `agent login` and retry `cursor-agent-bridge doctor`.",
    }
  }
}

async function checkBridgeHealth(
  host: string,
  port: number,
  fetchFn: typeof fetch,
): Promise<DoctorCheck> {
  const url = `http://${host}:${port}/health`
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(3_000) })
    if (!response.ok) {
      return {
        name: "bridge-health",
        ok: false,
        message: `${url} returned HTTP ${response.status}`,
        hint: "Start the bridge with `cursor-agent-bridge serve` or `cursor-agent-bridge launch-agent install`.",
      }
    }

    const payload = (await response.json()) as { version?: string }
    return {
      name: "bridge-health",
      ok: true,
      message: payload.version
        ? `Bridge is listening on ${url} (version ${payload.version})`
        : `Bridge is listening on ${url}`,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bridge health check failed"
    return {
      name: "bridge-health",
      ok: false,
      message,
      hint: "Start the bridge with `cursor-agent-bridge serve` or `cursor-agent-bridge launch-agent install`.",
    }
  }
}

async function checkCodexConfigFile(options: {
  codexConfigPath: string
  host: string
  port: number
  profile: string
  readFileFn: typeof readFile
}): Promise<DoctorCheck> {
  try {
    const content = await options.readFileFn(options.codexConfigPath, "utf8")
    const result = checkCodexConfig(content, {
      host: options.host,
      port: options.port,
      profile: options.profile,
    })

    if (result.ok) {
      return {
        name: "codex-config",
        ok: true,
        message: `Codex config looks correct at ${options.codexConfigPath}`,
      }
    }

    return {
      name: "codex-config",
      ok: false,
      message: result.issues.join("; "),
      hint: "Run `cursor-agent-bridge config write` or `cursor-agent-bridge config print`.",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        name: "codex-config",
        ok: false,
        message: `Codex config not found at ${options.codexConfigPath}`,
        hint: "Run `cursor-agent-bridge config write` to create it.",
      }
    }

    const message =
      error instanceof Error ? error.message : "Codex config check failed"
    return {
      name: "codex-config",
      ok: false,
      message,
      hint: "Verify the Codex config path and file permissions.",
    }
  }
}

function parseMinimumNodeVersion(range: string) {
  const match = range.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return "0.0.0"
  return `${match[1]}.${match[2]}.${match[3] ?? 0}`
}

function compareNodeVersion(left: string, right: string) {
  const toParts = (value: string) =>
    value.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const [leftMajor = 0, leftMinor = 0, leftPatch = 0] = toParts(left)
  const [rightMajor = 0, rightMinor = 0, rightPatch = 0] = toParts(right)

  if (leftMajor !== rightMajor) return leftMajor - rightMajor
  if (leftMinor !== rightMinor) return leftMinor - rightMinor
  return leftPatch - rightPatch
}
