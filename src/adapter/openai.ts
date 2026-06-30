import { randomUUID } from "node:crypto";

export function createChatResponse(model: string, text: string) {
  return {
    id: `chatcmpl-${randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function createChatChunk(
  id: string,
  model: string,
  text: string,
  isFirst: boolean,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { role: isFirst ? "assistant" : undefined, content: text },
        finish_reason: null,
      },
    ],
  };
}

export function createChatDoneChunk(id: string, model: string) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
}

export function createResponseObject(
  model: string,
  text: string,
  responseId = `resp_${randomUUID().replaceAll("-", "")}`,
) {
  const itemId = `msg_${randomUUID().replaceAll("-", "")}`;
  const item: {
    id: string;
    type: "message";
    status: "completed";
    role: "assistant";
    content: Array<{
      type: "output_text";
      text: string;
      annotations: unknown[];
    }>;
  } = {
    id: itemId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };

  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [item],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

export function responseTextEvents(model: string, text: string) {
  const response = createResponseObject(model, text);
  const item = response.output[0];
  /* v8 ignore next -- createResponseObject always creates one output item. */
  if (!item) throw new Error("Responses output item was not created");
  const part = item.content[0];
  /* v8 ignore next -- createResponseObject always creates one output text part. */
  if (!part) throw new Error("Responses output text part was not created");

  return [
    ["response.created", { ...response, status: "in_progress", output: [] }],
    [
      "response.output_item.added",
      {
        response_id: response.id,
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      },
    ],
    [
      "response.content_part.added",
      {
        response_id: response.id,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { ...part, text: "" },
      },
    ],
    [
      "response.output_text.delta",
      {
        response_id: response.id,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: text,
      },
    ],
    [
      "response.output_text.done",
      {
        response_id: response.id,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        text,
      },
    ],
    [
      "response.content_part.done",
      {
        response_id: response.id,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part,
      },
    ],
    [
      "response.output_item.done",
      { response_id: response.id, output_index: 0, item },
    ],
    ["response.completed", { response }],
  ] as const;
}
