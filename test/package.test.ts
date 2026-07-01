import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("package metadata", () => {
  it("matches the GitHub repository required by npm provenance", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    )

    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/xwartz/cursor-agent-bridge",
    })
  })
})
