import { describe, expect, it } from "vitest"
import {
  parseAgentModelList,
  toCodexModelCatalog,
  toOpenAIModelList,
} from "../src/adapter/models.js"

describe("model catalog", () => {
  it("parses Cursor Agent model output", () => {
    const models = parseAgentModelList(`
Available models

auto - Auto
not a model line
composer-2.5-fast - Composer 2.5 Fast (current, default)
claude-4.5-sonnet - Sonnet 4.5
`)

    expect(models).toEqual([
      { id: "auto", name: "Auto" },
      { id: "composer-2.5-fast", name: "Composer 2.5 Fast (current, default)" },
      { id: "claude-4.5-sonnet", name: "Sonnet 4.5" },
    ])
  })

  it("creates OpenAI-compatible model list", () => {
    const list = toOpenAIModelList([{ id: "auto", name: "Auto" }])

    expect(list.object).toBe("list")
    expect(list.data[0]?.id).toBe("auto")
    expect(list.data[0]?.owned_by).toBe("cursor")
  })

  it("creates Codex-compatible model catalog", () => {
    const catalog = toCodexModelCatalog([
      { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },
    ])
    const model = catalog.models[0]

    expect(model?.slug).toBe("composer-2.5-fast")
    expect(model?.display_name).toBe("Composer 2.5 Fast")
    expect(model?.shell_type).toBe("shell_command")
    expect(model?.base_instructions).toContain("Codex")
  })
})
