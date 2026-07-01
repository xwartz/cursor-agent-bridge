import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildCodexConfigToml,
  checkCodexConfig,
  getCodexProviderStatus,
  parseCodexConfig,
  resolveCodexConfigPath,
  resolveCodexSwitchBackupPath,
  resolveCodexUserConfigPath,
  restoreCodexProviderBackup,
  switchCodexProvider,
  writeCodexConfig,
} from "../src/codex-config.js"

describe("codex config", () => {
  it("renders the documented Codex profile", () => {
    expect(buildCodexConfigToml({ host: "127.0.0.1", port: 4646 })).toBe(
      `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
`,
    )
  })

  it("rejects profile names that could escape the Codex config directory", () => {
    expect(() => resolveCodexConfigPath("../../tmp/pwn")).toThrow(
      "Invalid Codex profile",
    )
    expect(() =>
      buildCodexConfigToml({
        host: "127.0.0.1",
        port: 4646,
        profile: "cursor.bad",
      }),
    ).toThrow("Invalid Codex profile")
  })

  it("resolves the user-level Codex config path", () => {
    expect(resolveCodexUserConfigPath("/Users/test")).toBe(
      "/Users/test/.codex/config.toml",
    )
  })

  it("escapes generated TOML string values", () => {
    const host = '127.0.0.1"\nwire_api = "chat'
    const content = buildCodexConfigToml({ host, port: 4646 })

    expect(content).not.toContain('\nwire_api = "chat')
    expect(parseCodexConfig(content)).toEqual({
      modelProvider: "cursor",
      model: "auto",
      providerName: "Cursor Agent Bridge",
      baseUrl: `http://${host}:4646/v1`,
      wireApi: "responses",
    })
  })

  it("parses the bridge fields from a config file", () => {
    const content = buildCodexConfigToml({ host: "127.0.0.1", port: 4646 })

    expect(parseCodexConfig(content)).toEqual({
      modelProvider: "cursor",
      model: "auto",
      providerName: "Cursor Agent Bridge",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("passes check when the config matches host and port", () => {
    const content = buildCodexConfigToml({ host: "127.0.0.1", port: 4646 })

    expect(
      checkCodexConfig(content, { host: "127.0.0.1", port: 4646 }),
    ).toEqual({
      ok: true,
      issues: [],
    })
  })

  it("reports mismatched base_url values", () => {
    const content = buildCodexConfigToml({ host: "127.0.0.1", port: 4321 })

    expect(
      checkCodexConfig(content, { host: "127.0.0.1", port: 4646 }),
    ).toEqual({
      ok: false,
      issues: [
        'base_url should be "http://127.0.0.1:4646/v1", found "http://127.0.0.1:4321/v1"',
      ],
    })
  })

  it("creates a new config file on write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result).toEqual({
      path: filePath,
      created: true,
      updated: false,
    })
    expect(await readFile(filePath, "utf8")).toBe(
      buildCodexConfigToml({ host: "127.0.0.1", port: 4646 }),
    )
  })

  it("updates bridge fields in an existing config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "gpt-5"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4321/v1"
wire_api = "responses"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.updated).toBe(true)
    expect(parseCodexConfig(await readFile(filePath, "utf8"))).toEqual({
      modelProvider: "cursor",
      model: "gpt-5",
      providerName: "Cursor Agent Bridge",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("reports missing wire_api and model_provider values", () => {
    const content = `[model_providers.cursor]
base_url = "http://127.0.0.1:4646/v1"
`

    expect(
      checkCodexConfig(content, { host: "127.0.0.1", port: 4646 }),
    ).toEqual({
      ok: false,
      issues: [
        'model_provider should be "cursor", but it is missing',
        'wire_api should be "responses", but it is missing',
      ],
    })
  })

  it("returns unchanged when the config already matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    const content = buildCodexConfigToml({ host: "127.0.0.1", port: 4646 })
    await writeFile(filePath, content, "utf8")

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result).toEqual({
      path: filePath,
      created: false,
      updated: false,
    })
  })

  it("adds missing provider section keys when merging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
base_url = "http://127.0.0.1:4646/v1"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.updated).toBe(true)
    expect(parseCodexConfig(await readFile(filePath, "utf8"))).toEqual({
      modelProvider: "cursor",
      model: "auto",
      providerName: "Cursor Agent Bridge",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("adds missing top-level keys and the provider section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `[profiles.default]
model = "gpt-5"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.updated).toBe(true)
    const content = await readFile(filePath, "utf8")
    expect(content).toContain('model_provider = "cursor"')
    expect(content).toContain('model = "auto"')
    expect(content).toContain("[model_providers.cursor]")
    expect(content).toContain('base_url = "http://127.0.0.1:4646/v1"')
    expect(content).toContain("[profiles.default]")
  })

  it("preserves unrelated section assignments while updating the bridge section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Old Name"
wire_api = "responses"

[profiles.other]
base_url = "https://api.example.test/v1"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.updated).toBe(true)
    const content = await readFile(filePath, "utf8")
    expect(content).toContain('name = "Cursor Agent Bridge"')
    expect(content).toContain('base_url = "http://127.0.0.1:4646/v1"')
    expect(content).toContain('base_url = "https://api.example.test/v1"')
  })

  it("forces model back to auto when replacing an existing profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "gpt-5"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
      force: true,
    })

    expect(result.updated).toBe(true)
    expect(parseCodexConfig(await readFile(filePath, "utf8"))).toEqual({
      modelProvider: "cursor",
      model: "auto",
      providerName: "Cursor Agent Bridge",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("parses single-quoted TOML values", () => {
    const content = `model_provider = 'cursor'

[model_providers.cursor]
wire_api = 'responses'
`

    expect(parseCodexConfig(content)).toEqual({
      modelProvider: "cursor",
      wireApi: "responses",
    })
  })

  it("unescapes common TOML string escapes", () => {
    const content = `model_provider = "cursor"

[model_providers.cursor]
name = "Cursor\\tAgent\\nBridge\\fTest\\rDone\\bX"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
`

    expect(parseCodexConfig(content).providerName).toBe(
      "Cursor\tAgent\nBridge\fTest\rDone\bX",
    )
  })

  it("parses bare TOML values used by existing hand-written configs", () => {
    const content = `model_provider = cursor

[model_providers.cursor]
base_url = http://127.0.0.1:4646/v1
wire_api = responses
`

    expect(parseCodexConfig(content)).toEqual({
      modelProvider: "cursor",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("ignores inline TOML comments after config values", () => {
    const content = `model_provider = "cursor" # use bridge by default
model = "auto"

[model_providers.cursor]
base_url = "http://127.0.0.1:4646/v1" # local bridge
wire_api = "responses"
`

    expect(parseCodexConfig(content)).toEqual({
      modelProvider: "cursor",
      model: "auto",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("requires force to replace a different model_provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "cursor.config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "auto"
`,
      "utf8",
    )

    await expect(
      writeCodexConfig({
        filePath,
        host: "127.0.0.1",
        port: 4646,
      }),
    ).rejects.toThrow('model_provider is "openai"')

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
      force: true,
    })

    expect(result.updated).toBe(true)
    expect(
      parseCodexConfig(await readFile(filePath, "utf8")).modelProvider,
    ).toBe("cursor")
  })

  it("allows config write when the selected provider already matches the target profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-config-"))
    const filePath = join(dir, "openai.config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "gpt-5"

[model_providers.openai]
name = "OpenAI"
`,
      "utf8",
    )

    const result = await writeCodexConfig({
      filePath,
      host: "127.0.0.1",
      port: 4646,
      profile: "openai",
    })

    expect(result.updated).toBe(true)
    expect(
      parseCodexConfig(await readFile(filePath, "utf8"), "openai"),
    ).toMatchObject({
      modelProvider: "openai",
      providerName: "Cursor Agent Bridge",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })
  })

  it("switches the user config to cursor with a restorable backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      `model_provider = "openai"
model = "gpt-5.5"

[mcp_servers.docs]
command = "docs"
`,
      "utf8",
    )

    const result = await switchCodexProvider({
      filePath,
      mode: "cursor",
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.changed).toBe(true)
    expect(result.backupPath).toBe(resolveCodexSwitchBackupPath(filePath))
    expect(parseCodexConfig(await readFile(filePath, "utf8"))).toMatchObject({
      modelProvider: "cursor",
      model: "auto",
      baseUrl: "http://127.0.0.1:4646/v1",
      wireApi: "responses",
    })

    const restored = await switchCodexProvider({
      filePath,
      mode: "openai",
      host: "127.0.0.1",
      port: 4646,
    })

    expect(restored.restoredBackup).toBe(true)
    expect(await readFile(filePath, "utf8")).toContain('model = "gpt-5.5"')
    expect(await readFile(filePath, "utf8")).toContain("[mcp_servers.docs]")
  })

  it("does not overwrite the backup when already switched to cursor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(filePath, 'model_provider = "openai"\n', "utf8")

    await switchCodexProvider({
      filePath,
      mode: "cursor",
      host: "127.0.0.1",
      port: 4646,
    })
    const backupPath = resolveCodexSwitchBackupPath(filePath)
    const originalBackup = await readFile(backupPath, "utf8")

    await switchCodexProvider({
      filePath,
      mode: "cursor",
      host: "127.0.0.1",
      port: 4647,
    })

    expect(await readFile(backupPath, "utf8")).toBe(originalBackup)
  })

  it("returns unchanged when switching an already-current cursor config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      buildCodexConfigToml({ host: "127.0.0.1", port: 4646 }),
      "utf8",
    )

    await expect(
      switchCodexProvider({
        filePath,
        mode: "cursor",
        host: "127.0.0.1",
        port: 4646,
      }),
    ).resolves.toEqual({
      path: filePath,
      mode: "cursor",
      changed: false,
    })
  })

  it("falls back to Codex defaults when switching to openai without a backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"

[mcp_servers.docs]
command = "docs"
`,
      "utf8",
    )

    const result = await switchCodexProvider({
      filePath,
      mode: "openai",
      host: "127.0.0.1",
      port: 4646,
    })
    const content = await readFile(filePath, "utf8")

    expect(result.restoredBackup).toBe(false)
    expect(content).not.toContain('model_provider = "cursor"')
    expect(content).not.toContain('model = "auto"')
    expect(content).toContain("[model_providers.cursor]")
    expect(content).toContain("[mcp_servers.docs]")
  })

  it("preserves non-cursor top-level keys when switching to openai without backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "gpt-5.5"
approval_policy = "on-request"
`,
      "utf8",
    )

    const result = await switchCodexProvider({
      filePath,
      mode: "openai",
      host: "127.0.0.1",
      port: 4646,
    })
    const content = await readFile(filePath, "utf8")

    expect(result.changed).toBe(true)
    expect(content).not.toContain('model_provider = "cursor"')
    expect(content).toContain('model = "gpt-5.5"')
    expect(content).toContain('approval_policy = "on-request"')
  })

  it("can switch an empty cursor config back to an empty default config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(
      filePath,
      `model_provider = "cursor"
model = "auto"
`,
      "utf8",
    )

    const result = await switchCodexProvider({
      filePath,
      mode: "openai",
      host: "127.0.0.1",
      port: 4646,
    })

    expect(result.changed).toBe(true)
    expect(await readFile(filePath, "utf8")).toBe("")
  })

  it("returns unchanged when switching a default config to openai without backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(filePath, '[mcp_servers.docs]\ncommand = "docs"\n', "utf8")

    await expect(
      switchCodexProvider({
        filePath,
        mode: "openai",
        host: "127.0.0.1",
        port: 4646,
      }),
    ).resolves.toEqual({
      path: filePath,
      mode: "openai",
      changed: false,
      restoredBackup: false,
    })
  })

  it("reports current provider status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    await writeFile(filePath, 'model_provider = "cursor"\n', "utf8")

    await expect(getCodexProviderStatus(filePath)).resolves.toEqual({
      path: filePath,
      exists: true,
      modelProvider: "cursor",
    })
    await expect(
      getCodexProviderStatus(join(dir, "missing.toml")),
    ).resolves.toEqual({
      path: join(dir, "missing.toml"),
      exists: false,
      modelProvider: undefined,
    })
  })

  it("restores the explicit switch backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")
    const backupPath = resolveCodexSwitchBackupPath(filePath)
    await writeFile(filePath, 'model_provider = "cursor"\n', "utf8")
    await writeFile(backupPath, 'model_provider = "openai"\n', "utf8")

    const result = await restoreCodexProviderBackup(filePath)

    expect(result).toEqual({
      path: filePath,
      backupPath,
      changed: true,
    })
    expect(await readFile(filePath, "utf8")).toBe('model_provider = "openai"\n')
  })

  it("rejects restore when no switch backup exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-switch-"))
    const filePath = join(dir, "config.toml")

    await expect(restoreCodexProviderBackup(filePath)).rejects.toThrow(
      "No switch backup found",
    )
  })
})
