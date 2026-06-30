import { describe, expect, it } from "vitest";
import {
  createChatResponse,
  createResponseObject,
  responseTextEvents,
} from "../src/adapter/openai.js";

describe("OpenAI protocol adapters", () => {
  it("creates chat completion responses", () => {
    const response = createChatResponse("auto", "OK");

    expect(response.object).toBe("chat.completion");
    expect(response.choices[0]?.message.content).toBe("OK");
  });

  it("creates Responses API objects", () => {
    const response = createResponseObject("auto", "OK");

    expect(response.object).toBe("response");
    expect(response.output[0]?.content[0]?.text).toBe("OK");
  });

  it("emits completion events for Codex SSE", () => {
    const events = responseTextEvents("auto", "OK");

    expect(events.map(([event]) => event)).toContain("response.completed");
    expect(events[0]?.[1]).toHaveProperty("status", "in_progress");
  });
});
