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
  itemId = `msg_${randomUUID().replaceAll("-", "")}`,
) {
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

export function createResponseStream(model: string) {
  const response = createResponseObject(model, "");
  const item = response.output[0];
  /* v8 ignore next -- createResponseObject always creates one output item. */
  if (!item) throw new Error("Responses output item was not created");
  const part = item.content[0];
  /* v8 ignore next -- createResponseObject always creates one output text part. */
  if (!part) throw new Error("Responses output text part was not created");

  return {
    response,
    item,
    part,
    events: [
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
    ] as const,
  };
}

export function responseDeltaEvent(
  stream: ReturnType<typeof createResponseStream>,
  delta: string,
) {
  return [
    "response.output_text.delta",
    {
      response_id: stream.response.id,
      item_id: stream.item.id,
      output_index: 0,
      content_index: 0,
      delta,
    },
  ] as const;
}

export function responseDoneEvents(
  stream: ReturnType<typeof createResponseStream>,
  model: string,
  text: string,
) {
  const response = createResponseObject(
    model,
    text,
    stream.response.id,
    stream.item.id,
  );
  const item = response.output[0];
  /* v8 ignore next -- createResponseObject always creates one output item. */
  if (!item) throw new Error("Responses output item was not created");
  const part = item.content[0];
  /* v8 ignore next -- createResponseObject always creates one output text part. */
  if (!part) throw new Error("Responses output text part was not created");

  return [
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

export function responseTextEvents(model: string, text: string) {
  const stream = createResponseStream(model);
  return [
    ...stream.events,
    responseDeltaEvent(stream, text),
    ...responseDoneEvents(stream, model, text),
  ] as const;
}
