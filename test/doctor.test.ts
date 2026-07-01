import { describe, expect, it, vi } from "vitest"
import { CursorRunner } from "../src/cursor/runner.js"
import {
  type ExecFileFn,
  formatDoctorReport,
  runDoctor,
} from "../src/doctor.js"
import { createFakeAgent } from "./helpers.js"

describe("doctor", () => {
  it("reports Node range failures with actionable hints", async () => {
    const [major = 0, minor = 0, patch = 0] = process.version
      .slice(1)
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)

    for (const nodeVersionRange of [
      `>=${major + 1}.0.0`,
      `>=${major}.${minor + 1}`,
      `>=${major}.${minor + 1}.0`,
      `>=${major}.${minor}.${patch + 1}`,
    ]) {
      const result = await runDoctor({
        host: "127.0.0.1",
        port: 4646,
        nodeVersionRange,
        skipCodexConfig: true,
        fetchFn: vi.fn(async () => ({
          ok: true,
          json: async () => ({ version: "0.1.3" }),
        })) as unknown as typeof fetch,
        execFileFn: vi.fn(async () => {
          throw new Error("ENOENT")
        }) as ExecFileFn,
      })

      expect(result.checks[0]).toEqual(
        expect.objectContaining({
          name: "node-version",
          ok: false,
          hint: expect.stringContaining("Install Node"),
        }),
      )
    }
  })

  it("treats unparsable Node ranges as non-blocking", async () => {
    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      nodeVersionRange: "latest",
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => {
        throw new Error("ENOENT")
      }) as ExecFileFn,
    })

    expect(result.checks[0]).toEqual(
      expect.objectContaining({
        name: "node-version",
        ok: true,
      }),
    )
  })

  it("reports all checks as passing when dependencies are healthy", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(true)
    expect(result.checks.map((check) => check.name)).toEqual([
      "node-version",
      "bridge-version",
      "agent-cli",
      "agent-login",
      "bridge-health",
    ])
    expect(formatDoctorReport(result)).toContain("All checks passed")
  })

  it("fails when the bridge is not listening", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => {
        throw new Error("fetch failed")
      }) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(false)
    expect(
      result.checks.find((check) => check.name === "bridge-health"),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        hint: expect.stringContaining("cursor-agent-bridge serve"),
      }),
    )
  })

  it("falls back to a generic bridge message for non-Error failures", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => {
        throw "offline"
      }) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(
      result.checks.find((check) => check.name === "bridge-health"),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        message: "Bridge health check failed",
      }),
    )
  })

  it("fails when the bridge health endpoint returns an error", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(false)
    expect(
      result.checks.find((check) => check.name === "bridge-health"),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        message: "http://127.0.0.1:4646/health returned HTTP 503",
      }),
    )
  })

  it("passes bridge health when version is absent", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(true)
    expect(
      result.checks.find((check) => check.name === "bridge-health"),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        message: "Bridge is listening on http://127.0.0.1:4646/health",
      }),
    )
  })

  it("fails when the agent CLI is missing", async () => {
    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath: "/missing/agent",
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => {
        throw new Error("ENOENT")
      }) as ExecFileFn,
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find((check) => check.name === "agent-cli")).toEqual(
      expect.objectContaining({
        ok: false,
        hint: expect.stringContaining("CURSOR_AGENT_PATH"),
      }),
    )
  })

  it("falls back to a generic agent message for non-Error failures", async () => {
    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => {
        throw "missing"
      }) as ExecFileFn,
    })

    expect(result.checks.find((check) => check.name === "agent-cli")).toEqual(
      expect.objectContaining({
        ok: false,
        message: "Cursor Agent CLI not found",
      }),
    )
  })

  it("fails when Cursor Agent is not logged in", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--help")) {
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  console.error("not logged in");
  process.exit(1);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find((check) => check.name === "agent-login")).toEqual(
      expect.objectContaining({
        ok: false,
        hint: expect.stringContaining("agent login"),
      }),
    )
  })

  it("fails when Cursor Agent returns no models", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--help")) {
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      skipCodexConfig: true,
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
    })

    expect(result.ok).toBe(false)
    expect(result.checks.find((check) => check.name === "agent-login")).toEqual(
      expect.objectContaining({
        ok: false,
        message: "Cursor Agent responded, but returned no models",
      }),
    )
  })

  it("passes when Codex config matches host and port", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })
    const codexConfig = `model_provider = "cursor"
model = "auto"

[model_providers.cursor]
name = "Cursor Agent Bridge"
base_url = "http://127.0.0.1:4646/v1"
wire_api = "responses"
`

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      codexConfigPath: "/tmp/cursor.config.toml",
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
      readFileFn: vi.fn(
        async () => codexConfig,
      ) as unknown as typeof import("node:fs/promises").readFile,
    })

    expect(result.ok).toBe(true)
    expect(result.checks.at(-1)).toEqual(
      expect.objectContaining({
        name: "codex-config",
        ok: true,
      }),
    )
  })

  it("checks Codex config when enabled", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      codexConfigPath: "/tmp/cursor.config.toml",
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
      readFileFn: vi.fn(async () =>
        Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
      ),
    })

    expect(result.checks.at(-1)).toEqual(
      expect.objectContaining({
        name: "codex-config",
        ok: false,
        hint: "Run `cursor-agent-bridge config write` to create it.",
      }),
    )
  })

  it("fails when Codex config does not match the bridge URL", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      codexConfigPath: "/tmp/cursor.config.toml",
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
      readFileFn: vi.fn(
        async () => `model_provider = "cursor"

[model_providers.cursor]
base_url = "http://127.0.0.1:4321/v1"
wire_api = "responses"
`,
      ) as unknown as typeof import("node:fs/promises").readFile,
    })

    expect(result.ok).toBe(false)
    expect(result.checks.at(-1)).toEqual(
      expect.objectContaining({
        name: "codex-config",
        ok: false,
        hint: "Run `cursor-agent-bridge config write` or `cursor-agent-bridge config print`.",
      }),
    )
  })

  it("fails with a file-permission hint when Codex config cannot be read", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      codexConfigPath: "/tmp/cursor.config.toml",
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
      readFileFn: vi.fn(async () =>
        Promise.reject(
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        ),
      ),
    })

    expect(result.ok).toBe(false)
    expect(result.checks.at(-1)).toEqual(
      expect.objectContaining({
        name: "codex-config",
        ok: false,
        message: "permission denied",
        hint: "Verify the Codex config path and file permissions.",
      }),
    )
  })

  it("falls back to a generic Codex config message for non-Error read failures", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.exit(0);
}
`)
    const runner = new CursorRunner({ agentPath })

    const result = await runDoctor({
      host: "127.0.0.1",
      port: 4646,
      agentPath,
      runner,
      codexConfigPath: "/tmp/cursor.config.toml",
      fetchFn: vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "0.1.3" }),
      })) as unknown as typeof fetch,
      execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) as ExecFileFn,
      readFileFn: vi.fn(async () => Promise.reject("unreadable")),
    })

    expect(result.checks.at(-1)).toEqual(
      expect.objectContaining({
        name: "codex-config",
        ok: false,
        message: "Codex config check failed",
      }),
    )
  })
})
