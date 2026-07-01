import { describe, expect, it } from "vitest"
import {
  messagesToPrompt,
  normalizeModel,
  responsesToMessages,
} from "../src/adapter/messages.js"

describe("message adapters", () => {
  it("keeps a single user message clean", () => {
    expect(messagesToPrompt([{ role: "user", content: "hello" }])).toBe("hello")
  })

  it("extracts text from array message content", () => {
    expect(
      messagesToPrompt([
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "text", input_text: "typed" },
            { type: "text", output_text: "done" },
          ],
        },
      ]),
    ).toBe("hello\ntyped\ndone")
  })

  it("adds role markers for multi-turn prompts", () => {
    expect(
      messagesToPrompt([
        { role: "system", content: "be brief" },
        { role: "user", content: "hello" },
      ]),
    ).toBe("[System]\nbe brief\n\n[User]\nhello")
  })

  it("converts Responses input items into chat messages", () => {
    const messages = responsesToMessages({
      instructions: "be brief",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      ],
    })

    expect(messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ])
  })

  it("converts string, input_text, and assistant Responses items", () => {
    const messages = responsesToMessages({
      input: [
        "plain",
        { type: "input_text", input_text: "typed" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", output_text: "previous" }],
        },
        null,
      ],
    })

    expect(messages).toEqual([
      { role: "user", content: "plain" },
      { role: "user", content: "typed" },
      { role: "assistant", content: "previous" },
    ])
  })

  it("handles system messages, empty content, and unknown Responses items", () => {
    const messages = responsesToMessages({
      input: [
        { type: "message", role: "system", content: "rules" },
        { type: "message", role: "user", content: [] },
        { type: "unknown", value: "ignored" },
        { type: "input_text", text: "" },
      ],
    })

    expect(messages).toEqual([{ role: "system", content: "rules" }])
  })

  it("falls back to an empty user message for empty Responses input", () => {
    expect(responsesToMessages({ input: [] })).toEqual([
      { role: "user", content: "" },
    ])
  })

  it("normalizes cursor-prefixed models", () => {
    expect(normalizeModel("cursor/composer-2.5-fast")).toBe("composer-2.5-fast")
    expect(normalizeModel("cursor-claude-4.5-sonnet")).toBe("claude-4.5-sonnet")
    expect(normalizeModel("cursor/")).toBe("auto")
    expect(normalizeModel("cursor-")).toBe("auto")
    expect(normalizeModel(undefined)).toBe("auto")
  })
})
