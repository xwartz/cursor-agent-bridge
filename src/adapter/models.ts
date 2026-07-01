import type { BridgeModel } from "../types.js"

export function parseAgentModelList(output: string): BridgeModel[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([a-zA-Z0-9_.-]+)\s+-\s+(.+)$/)
      return match ? { id: match[1] ?? "", name: match[2] ?? "" } : null
    })
    .filter((model): model is BridgeModel => Boolean(model?.id && model.name))
}

export function toOpenAIModelList(models: BridgeModel[]) {
  const created = Math.floor(Date.now() / 1000)
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      owned_by: "cursor",
      created,
    })),
  }
}

export function toCodexModelCatalog(models: BridgeModel[]) {
  return {
    models: models.map((model, index) => ({
      slug: model.id,
      display_name: model.name,
      description: "Cursor model via Cursor Agent CLI.",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: Math.max(0, 1000 - index),
      additional_speed_tiers: [],
      service_tiers: [],
      default_service_tier: null,
      availability_nux: null,
      upgrade: null,
      base_instructions:
        "You are Codex, a coding agent. Help the user with software engineering tasks in the current workspace.",
      model_messages: null,
      supports_reasoning_summaries: false,
      default_reasoning_summary: "none",
      support_verbosity: false,
      default_verbosity: "low",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text_and_image",
      truncation_policy: { mode: "tokens", limit: 10000 },
      supports_parallel_tool_calls: true,
      supports_image_detail_original: true,
      context_window: 128000,
      max_context_window: 128000,
      effective_context_window_percent: 95,
      experimental_supported_tools: [],
      input_modalities: ["text"],
      supports_search_tool: false,
      use_responses_lite: false,
    })),
  }
}
