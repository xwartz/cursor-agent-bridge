import type { ChatMessage, ResponsesRequest } from "../types.js";

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;

  return content
    .map((part) => part.text ?? part.input_text ?? part.output_text ?? "")
    .filter(Boolean)
    .join("\n");
}

export function messagesToPrompt(messages: ChatMessage[]): string {
  const nonEmpty = messages.filter(
    (message) => contentToText(message.content).length > 0,
  );

  if (nonEmpty.length === 1 && nonEmpty[0]?.role === "user") {
    return contentToText(nonEmpty[0].content);
  }

  return nonEmpty
    .map((message) => {
      const label =
        message.role === "system"
          ? "System"
          : message.role === "assistant"
            ? "Assistant"
            : "User";
      return `[${label}]\n${contentToText(message.content)}`;
    })
    .join("\n\n");
}

function responseContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return String(
        record.text ?? record.input_text ?? record.output_text ?? "",
      );
    })
    .filter(Boolean)
    .join("\n");
}

export function responsesToMessages(request: ResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (request.instructions) {
    messages.push({ role: "system", content: request.instructions });
  }

  const inputItems = Array.isArray(request.input)
    ? request.input
    : [{ role: "user", content: request.input ?? "" }];

  for (const item of inputItems) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role =
      record.role === "assistant"
        ? "assistant"
        : record.role === "system"
          ? "system"
          : "user";

    if (record.type === "message" || record.role) {
      const text = responseContentToText(record.content);
      if (text) messages.push({ role, content: text });
      continue;
    }

    if (record.type === "input_text" || record.type === "output_text") {
      const text = responseContentToText([record]);
      if (text) messages.push({ role: "user", content: text });
    }
  }

  return messages.length > 0 ? messages : [{ role: "user", content: "" }];
}

export function normalizeModel(model: string | undefined): string {
  if (!model) return "auto";
  if (model.startsWith("cursor/"))
    return model.slice("cursor/".length) || "auto";
  if (model.startsWith("cursor-"))
    return model.slice("cursor-".length) || "auto";
  return model;
}
