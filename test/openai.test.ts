import { describe, expect, it } from "vitest";
import {
  createChatChunk,
  createChatDoneChunk,
  createChatResponse,
  createResponseObject,
  createResponseStream,
  responseDeltaEvent,
  responseDoneEvents,
  responseTextEvents,
} from "../src/adapter/openai.js";

describe("OpenAI protocol adapters", () => {
  it("creates chat completion responses", () => {
    const response = createChatResponse("auto", "OK");

    expect(response.object).toBe("chat.completion");
    expect(response.choices[0]?.message.content).toBe("OK");
  });

  it("creates streaming chat chunks", () => {
    expect(createChatChunk("id", "auto", "O", true).choices[0]?.delta).toEqual({
      role: "assistant",
      content: "O",
    });
    expect(createChatChunk("id", "auto", "K", false).choices[0]?.delta).toEqual(
      {
        role: undefined,
        content: "K",
      },
    );
    expect(createChatDoneChunk("id", "auto").choices[0]?.finish_reason).toBe(
      "stop",
    );
  });

  it("creates Responses API objects", () => {
    const response = createResponseObject("auto", "OK", "resp_test");

    expect(response.id).toBe("resp_test");
    expect(response.object).toBe("response");
    expect(response.output[0]?.content[0]?.text).toBe("OK");
  });

  it("emits completion events for Codex SSE", () => {
    const events = responseTextEvents("auto", "OK");
    const created = events[0]?.[1] as { id: string };
    const completed = events.at(-1)?.[1] as { response: { id: string } };

    expect(events.map(([event]) => event)).toContain("response.completed");
    expect(created).toHaveProperty("status", "in_progress");
    expect(created.id).toBe(completed.response.id);
  });

  it("creates incremental Responses API stream events with stable ids", () => {
    const stream = createResponseStream("auto");
    const [, delta] = responseDeltaEvent(stream, "O");
    const doneEvents = responseDoneEvents(stream, "composer", "OK");
    const completed = doneEvents.at(-1)?.[1] as {
      response: { id: string; model: string };
    };

    expect(delta.response_id).toBe(stream.response.id);
    expect(completed.response.id).toBe(stream.response.id);
    expect(completed.response.model).toBe("composer");
  });
});
