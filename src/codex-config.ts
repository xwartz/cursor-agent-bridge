import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const DEFAULT_CODEX_PROFILE = "cursor"
export const OPENAI_PROVIDER = "openai"
export const USER_CODEX_CONFIG_FILE = "config.toml"
export const SWITCH_BACKUP_SUFFIX = ".bak.cursor-agent-bridge"

export type CodexConfigOptions = {
  host: string
  port: number
  profile?: string
}

export type CodexConfigFields = {
  modelProvider?: string
  model?: string
  providerName?: string
  baseUrl?: string
  wireApi?: string
}

export type CodexConfigCheckResult = {
  ok: boolean
  issues: string[]
}

export type WriteCodexConfigResult = {
  path: string
  created: boolean
  updated: boolean
}

export type CodexSwitchMode = "cursor" | typeof OPENAI_PROVIDER

export type SwitchCodexProviderResult = {
  path: string
  mode: CodexSwitchMode
  changed: boolean
  backupPath?: string
  restoredBackup?: boolean
}

export function resolveCodexConfigPath(
  profile = DEFAULT_CODEX_PROFILE,
  homeDir = homedir(),
) {
  assertValidProfile(profile)
  return join(homeDir, ".codex", `${profile}.config.toml`)
}

export function resolveCodexUserConfigPath(homeDir = homedir()) {
  return join(homeDir, ".codex", USER_CODEX_CONFIG_FILE)
}

export function resolveCodexSwitchBackupPath(filePath: string) {
  return `${filePath}${SWITCH_BACKUP_SUFFIX}`
}

export function buildBaseUrl(host: string, port: number) {
  return `http://${host}:${port}/v1`
}

export function buildCodexConfigToml(options: CodexConfigOptions) {
  const profile = options.profile ?? DEFAULT_CODEX_PROFILE
  assertValidProfile(profile)
  const baseUrl = buildBaseUrl(options.host, options.port)
  return `model_provider = ${formatTomlString(profile)}
model = "auto"

[model_providers.${profile}]
name = "Cursor Agent Bridge"
base_url = ${formatTomlString(baseUrl)}
wire_api = "responses"
`
}

export function parseCodexConfig(
  content: string,
  profile = DEFAULT_CODEX_PROFILE,
) {
  assertValidProfile(profile)
  const fields: CodexConfigFields = {}
  const providerSection = `model_providers.${profile}`
  let section = ""

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1] ?? ""
      continue
    }

    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!assignment) continue

    const key = assignment[1] as string
    const value = parseTomlValue(assignment[2] ?? "")

    if (section === providerSection) {
      if (key === "name") fields.providerName = value
      if (key === "base_url") fields.baseUrl = value
      if (key === "wire_api") fields.wireApi = value
      continue
    }

    if (section) continue
    if (key === "model_provider") fields.modelProvider = value
    if (key === "model") fields.model = value
  }

  return fields
}

export function checkCodexConfig(
  content: string,
  options: CodexConfigOptions,
): CodexConfigCheckResult {
  const profile = options.profile ?? DEFAULT_CODEX_PROFILE
  const expectedBaseUrl = buildBaseUrl(options.host, options.port)
  const fields = parseCodexConfig(content, profile)
  const issues: string[] = []

  if (fields.modelProvider !== profile) {
    issues.push(
      `model_provider should be "${profile}"${
        fields.modelProvider
          ? `, found "${fields.modelProvider}"`
          : ", but it is missing"
      }`,
    )
  }

  if (fields.baseUrl !== expectedBaseUrl) {
    issues.push(
      `base_url should be "${expectedBaseUrl}"${
        fields.baseUrl ? `, found "${fields.baseUrl}"` : ", but it is missing"
      }`,
    )
  }

  if (fields.wireApi !== "responses") {
    issues.push(
      `wire_api should be "responses"${
        fields.wireApi ? `, found "${fields.wireApi}"` : ", but it is missing"
      }`,
    )
  }

  return { ok: issues.length === 0, issues }
}

export async function writeCodexConfig(
  options: CodexConfigOptions & {
    filePath: string
    force?: boolean
  },
): Promise<WriteCodexConfigResult> {
  let existing: string | undefined

  try {
    existing = await readFile(options.filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  if (existing === undefined) {
    await mkdir(dirname(options.filePath), { recursive: true })
    await writeFile(options.filePath, buildCodexConfigToml(options), "utf8")
    return { path: options.filePath, created: true, updated: false }
  }

  const merged = mergeCodexConfig(existing, options)
  if ("error" in merged) throw new Error(merged.error)

  if (!merged.changed) {
    return { path: options.filePath, created: false, updated: false }
  }

  await writeFile(options.filePath, merged.content, "utf8")
  return { path: options.filePath, created: false, updated: true }
}

export async function getCodexProviderStatus(filePath: string) {
  const content = await readCodexConfigIfExists(filePath)
  return content === undefined
    ? { path: filePath, exists: false, modelProvider: undefined }
    : {
        path: filePath,
        exists: true,
        modelProvider: parseCodexConfig(content).modelProvider,
      }
}

export async function switchCodexProvider(
  options: CodexConfigOptions & {
    filePath: string
    mode: CodexSwitchMode
  },
): Promise<SwitchCodexProviderResult> {
  const existing = await readCodexConfigIfExists(options.filePath)
  const backupPath = resolveCodexSwitchBackupPath(options.filePath)

  if (options.mode === "cursor") {
    await mkdir(dirname(options.filePath), { recursive: true })
    const existingProvider =
      existing === undefined
        ? undefined
        : parseCodexConfig(existing).modelProvider
    if (existing !== undefined && existingProvider !== DEFAULT_CODEX_PROFILE) {
      await copyFile(options.filePath, backupPath)
    }

    const merged =
      existing === undefined
        ? { content: buildCodexConfigToml(options), changed: true }
        : mergeCodexConfig(existing, { ...options, force: true })
    if ("error" in merged) throw new Error(merged.error)
    if (!merged.changed && existing !== undefined) {
      return {
        path: options.filePath,
        mode: "cursor",
        changed: false,
        ...(existingProvider !== DEFAULT_CODEX_PROFILE && existing !== undefined
          ? { backupPath }
          : {}),
      }
    }

    await writeFileAtomic(options.filePath, merged.content)
    return {
      path: options.filePath,
      mode: "cursor",
      changed: true,
      ...(existingProvider !== DEFAULT_CODEX_PROFILE && existing !== undefined
        ? { backupPath }
        : {}),
    }
  }

  const backup = await readCodexConfigIfExists(backupPath)
  if (backup !== undefined) {
    await writeFileAtomic(options.filePath, backup)
    return {
      path: options.filePath,
      mode: OPENAI_PROVIDER,
      changed: normalizeToml(existing ?? "") !== normalizeToml(backup),
      backupPath,
      restoredBackup: true,
    }
  }

  const content = removeCursorProviderSelection(existing ?? "")
  if (normalizeToml(content) === normalizeToml(existing ?? "")) {
    return {
      path: options.filePath,
      mode: OPENAI_PROVIDER,
      changed: false,
      restoredBackup: false,
    }
  }

  await mkdir(dirname(options.filePath), { recursive: true })
  await writeFileAtomic(options.filePath, content)
  return {
    path: options.filePath,
    mode: OPENAI_PROVIDER,
    changed: true,
    restoredBackup: false,
  }
}

export async function restoreCodexProviderBackup(filePath: string) {
  const backupPath = resolveCodexSwitchBackupPath(filePath)
  const backup = await readCodexConfigIfExists(backupPath)
  if (backup === undefined) {
    throw new Error(`No switch backup found at ${backupPath}`)
  }

  const existing = await readCodexConfigIfExists(filePath)
  await writeFileAtomic(filePath, backup)
  return {
    path: filePath,
    backupPath,
    changed: normalizeToml(existing ?? "") !== normalizeToml(backup),
  }
}

function mergeCodexConfig(
  existing: string,
  options: CodexConfigOptions & { force?: boolean },
) {
  const profile = options.profile ?? DEFAULT_CODEX_PROFILE
  assertValidProfile(profile)
  const providerSection = `model_providers.${profile}`
  const expected = buildCodexConfigToml(options)
  const parsed = parseCodexConfig(existing, profile)

  if (
    parsed.modelProvider &&
    parsed.modelProvider !== profile &&
    !options.force
  ) {
    return {
      error: `model_provider is "${parsed.modelProvider}". Re-run with --force to switch it to "${profile}".`,
    }
  }

  const lines = existing.split("\n")
  const output: string[] = []
  let section = ""
  let inProviderSection = false
  let sawModelProvider = false
  let sawModel = false
  let sawProviderSection = false
  const handledProviderKeys = new Set<string>()

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      if (inProviderSection) appendMissingProviderKeys()
      section = sectionMatch[1] ?? ""
      inProviderSection = section === providerSection
      if (inProviderSection) sawProviderSection = true
      output.push(rawLine)
      continue
    }

    const assignment = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!assignment) {
      output.push(rawLine)
      continue
    }

    const key = assignment[1] ?? ""

    if (!section) {
      if (key === "model_provider") {
        sawModelProvider = true
        output.push(`model_provider = ${formatTomlString(profile)}`)
        continue
      }
      if (key === "model") {
        sawModel = true
        if (parsed.model === undefined || options.force) {
          output.push('model = "auto"')
        } else {
          output.push(rawLine)
        }
        continue
      }
    }

    if (inProviderSection) {
      if (key === "name") {
        handledProviderKeys.add("name")
        output.push('name = "Cursor Agent Bridge"')
        continue
      }
      if (key === "base_url") {
        handledProviderKeys.add("base_url")
        output.push(
          `base_url = ${formatTomlString(buildBaseUrl(options.host, options.port))}`,
        )
        continue
      }
      if (key === "wire_api") {
        handledProviderKeys.add("wire_api")
        output.push('wire_api = "responses"')
        continue
      }
    }

    output.push(rawLine)
  }

  if (inProviderSection) appendMissingProviderKeys()

  const missingTopLevel: string[] = []
  if (!sawModelProvider)
    missingTopLevel.push(`model_provider = ${formatTomlString(profile)}`)
  if (!sawModel) missingTopLevel.push('model = "auto"')

  let content = output.join("\n").trimEnd()
  if (missingTopLevel.length > 0) {
    content = `${missingTopLevel.join("\n")}\n${content}`
  }

  if (!sawProviderSection) {
    const providerBlock = expected.split("\n").slice(3).join("\n")
    content = `${content}\n\n${providerBlock}\n`
  }

  const changed = normalizeToml(content) !== normalizeToml(existing)
  return { content: `${content.trimEnd()}\n`, changed }

  function appendMissingProviderKeys() {
    if (!handledProviderKeys.has("name")) {
      output.push('name = "Cursor Agent Bridge"')
    }
    if (!handledProviderKeys.has("base_url")) {
      output.push(
        `base_url = ${formatTomlString(buildBaseUrl(options.host, options.port))}`,
      )
    }
    if (!handledProviderKeys.has("wire_api")) {
      output.push('wire_api = "responses"')
    }
  }
}

async function readCodexConfigIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return undefined
  }
}

async function writeFileAtomic(filePath: string, content: string) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmpPath, content, "utf8")
  await rename(tmpPath, filePath)
}

function removeCursorProviderSelection(existing: string) {
  const lines = existing.split("\n")
  const output: string[] = []
  let section = ""

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1] as string
      output.push(rawLine)
      continue
    }

    const assignment = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!section && assignment) {
      const key = assignment[1] as string
      const value = parseTomlValue(assignment[2] as string)
      if (key === "model_provider" && value === DEFAULT_CODEX_PROFILE) continue
      if (key === "model" && value === "auto") continue
    }

    output.push(rawLine)
  }

  const content = output.join("\n").trimEnd()
  return content ? `${content}\n` : ""
}

function assertValidProfile(profile: string) {
  if (/^[A-Za-z0-9_-]+$/.test(profile)) return
  throw new Error(
    "Invalid Codex profile. Use only letters, numbers, underscores, or hyphens.",
  )
}

function formatTomlString(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\b", "\\b")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\f", "\\f")
    .replaceAll("\r", "\\r")}"`
}

function normalizeToml(content: string) {
  return content.replace(/\r\n/g, "\n").trimEnd()
}

function parseTomlValue(raw: string) {
  const trimmed = stripInlineTomlComment(raw).trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeTomlString(trimmed.slice(1, -1))
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function unescapeTomlString(value: string) {
  const escapes: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    b: "\b",
    t: "\t",
    n: "\n",
    f: "\f",
    r: "\r",
  }
  return value.replace(
    /\\(["\\btnfr])/g,
    (_match, escaped: string) => escapes[escaped] as string,
  )
}

function stripInlineTomlComment(raw: string) {
  let quote: string | undefined
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if ((char === '"' || char === "'") && raw[index - 1] !== "\\") {
      quote = quote === char ? undefined : (quote ?? char)
      continue
    }

    if (!quote && char === "#") {
      return raw.slice(0, index)
    }
  }

  return raw
}
