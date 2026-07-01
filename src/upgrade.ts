import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"
import { getLaunchAgentPaths } from "./launch-agent.js"

const execFileAsync = promisify(execFile)

export const PACKAGE_NAME = "cursor-agent-bridge"
export const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const REGISTRY_TIMEOUT_MS = 10_000

export type PackageManager = "npm" | "pnpm"
export type PackageManagerPreference = PackageManager | "auto"

export type ExecFileFn = (
  file: string,
  args?: readonly string[] | null,
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<unknown>

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { stdio: "inherit"; env?: NodeJS.ProcessEnv },
) => {
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "close", listener: (code: number | null) => void): unknown
}

export type UpgradeOptions = {
  currentVersion: string
  checkOnly?: boolean
  target?: string
  manager?: PackageManagerPreference
  registryUrl?: string
  fetchFn?: typeof fetch
  spawnFn?: SpawnFn
  execFileFn?: ExecFileFn
  existsFn?: typeof existsSync
  log?: (...args: unknown[]) => void
  errorLog?: (...args: unknown[]) => void
}

export function compareSemver(left: string, right: string): -1 | 0 | 1 {
  const toParts = (value: string) => {
    const [major = 0, minor = 0, patch = 0] = value
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
    return [major, minor, patch] as const
  }
  const [leftMajor, leftMinor, leftPatch] = toParts(left)
  const [rightMajor, rightMinor, rightPatch] = toParts(right)

  if (leftMajor !== rightMajor) {
    return leftMajor < rightMajor ? -1 : 1
  }
  if (leftMinor !== rightMinor) {
    return leftMinor < rightMinor ? -1 : 1
  }
  if (leftPatch !== rightPatch) {
    return leftPatch < rightPatch ? -1 : 1
  }
  return 0
}

export async function fetchLatestVersion(options?: {
  registryUrl?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}): Promise<string> {
  const registryUrl = options?.registryUrl ?? DEFAULT_REGISTRY_URL
  const fetchFn = options?.fetchFn ?? fetch
  const timeoutMs = options?.timeoutMs ?? REGISTRY_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn(registryUrl, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Registry returned ${response.status}`)
    }

    const payload = (await response.json()) as { version?: string }
    if (!payload.version) {
      throw new Error("Registry response missing version")
    }
    return payload.version
  } finally {
    clearTimeout(timeout)
  }
}

async function commandExists(
  command: string,
  execFileFn: ExecFileFn,
): Promise<boolean> {
  try {
    await execFileFn("which", [command])
    return true
  } catch {
    return false
  }
}

export async function detectPackageManager(
  preference: PackageManagerPreference,
  execFileFn: ExecFileFn = execFileAsync,
): Promise<PackageManager> {
  if (preference === "npm") return "npm"
  if (preference === "pnpm") return "pnpm"

  if (!(await commandExists("pnpm", execFileFn))) {
    return "npm"
  }

  try {
    await execFileFn("pnpm", ["list", "-g", PACKAGE_NAME, "--json"], {
      env: process.env,
    })
    return "pnpm"
  } catch {
    return "npm"
  }
}

export function buildInstallCommand(
  manager: PackageManager,
  target: string,
): { command: string; args: string[] } {
  const versionSpec =
    target === "latest" ? "@latest" : `@${target.replace(/^@/, "")}`
  const packageSpec = `${PACKAGE_NAME}${versionSpec}`

  if (manager === "pnpm") {
    return { command: "pnpm", args: ["add", "-g", packageSpec] }
  }

  return { command: "npm", args: ["install", "-g", packageSpec] }
}

function printManualUpgradeHint(errorLog: (...args: unknown[]) => void) {
  errorLog("Upgrade manually:")
  errorLog(`  pnpm add -g ${PACKAGE_NAME}@latest`)
  errorLog(`  npm install -g ${PACKAGE_NAME}@latest`)
}

async function resolveTargetVersion(
  target: string,
  registryUrl: string,
  fetchFn: typeof fetch,
): Promise<string> {
  if (target === "latest") {
    return fetchLatestVersion({ registryUrl, fetchFn })
  }
  return target.replace(/^@/, "")
}

async function runInstall(
  manager: PackageManager,
  target: string,
  spawnFn: SpawnFn,
): Promise<number> {
  const { command, args } = buildInstallCommand(manager, target)
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, {
      stdio: "inherit",
      env: process.env,
    })

    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })
}

export async function runUpgrade(options: UpgradeOptions): Promise<number> {
  const log = options.log ?? console.log
  const errorLog = options.errorLog ?? console.error
  const checkOnly = options.checkOnly ?? false
  const target = options.target ?? "latest"
  const managerPreference = options.manager ?? "auto"
  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL
  const fetchFn = options.fetchFn ?? fetch
  const spawnFn: SpawnFn =
    options.spawnFn ??
    ((command, args, spawnOptions) => spawn(command, args, spawnOptions))
  const execFileFn = options.execFileFn ?? execFileAsync
  const existsFn = options.existsFn ?? existsSync

  let targetVersion: string
  try {
    targetVersion = await resolveTargetVersion(target, registryUrl, fetchFn)
  } catch (error) {
    errorLog(
      `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`,
    )
    printManualUpgradeHint(errorLog)
    return 1
  }

  const comparison = compareSemver(options.currentVersion, targetVersion)
  if (comparison >= 0) {
    log(`${PACKAGE_NAME} is up to date (${options.currentVersion})`)
    return 0
  }

  if (checkOnly) {
    log(`Update available: ${options.currentVersion} -> ${targetVersion}`)
    return 1
  }

  let manager: PackageManager
  manager = await detectPackageManager(managerPreference, execFileFn)

  log(`Installing ${PACKAGE_NAME}@${targetVersion} via ${manager}...`)
  try {
    const exitCode = await runInstall(manager, target, spawnFn)
    if (exitCode !== 0) {
      errorLog(`${manager} install failed with exit code ${exitCode}`)
      printManualUpgradeHint(errorLog)
      return exitCode
    }
  } catch (error) {
    errorLog(
      `Install failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    printManualUpgradeHint(errorLog)
    return 1
  }

  log(`Installed ${PACKAGE_NAME}@${targetVersion}`)
  log("Run `cursor-agent-bridge --version` to verify the upgrade.")

  const launchAgentPlist = getLaunchAgentPaths().plistPath
  if (existsFn(launchAgentPlist)) {
    log(
      "LaunchAgent detected. Run `cursor-agent-bridge launch-agent install` to refresh the service.",
    )
  }

  return 0
}
