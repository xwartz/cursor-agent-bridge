import { describe, expect, it } from "vitest";
import {
  messagesToPrompt,
  normalizeModel,
  responsesToMessages,
} from "../src/adapter/messages.js";

describe("message adapters", () => {
  it("keeps a single user message clean", () => {
    expect(messagesToPrompt([{ role: "user", content: "hello" }])).toBe(
      "hello",
    );
  });

  it("adds role markers for multi-turn prompts", () => {
    expect(
      messagesToPrompt([
        { role: "system", content: "be brief" },
        { role: "user", content: "hello" },
      ]),
    ).toBe("[System]\nbe brief\n\n[User]\nhello");
  });

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
    });

    expect(messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
  });

  it("normalizes cursor-prefixed models", () => {
    expect(normalizeModel("cursor/composer-2.5-fast")).toBe(
      "composer-2.5-fast",
    );
    expect(normalizeModel("cursor-claude-4.5-sonnet")).toBe(
      "claude-4.5-sonnet",
    );
    expect(normalizeModel(undefined)).toBe("auto");
  });
});
