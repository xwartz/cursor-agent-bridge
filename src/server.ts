import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import packageJson from "../package.json" with { type: "json" };
import {
  messagesToPrompt,
  normalizeModel,
  responsesToMessages,
} from "./adapter/messages.js";
import { toCodexModelCatalog, toOpenAIModelList } from "./adapter/models.js";
import {
  createChatChunk,
  createChatDoneChunk,
  createChatResponse,
  createResponseObject,
  responseTextEvents,
} from "./adapter/openai.js";
import { CursorRunner } from "./cursor/runner.js";
import type {
  ChatCompletionRequest,
  ResponsesRequest,
  ServerConfig,
} from "./types.js";

const packageVersion = packageJson.version;

export async function startServer(config: ServerConfig = {}) {
  const port = config.port ?? Number(process.env.PORT || 4646);
  const host = config.host ?? process.env.HOST ?? "127.0.0.1";
  const runner = new CursorRunner({
    ...(config.agentPath ? { agentPath: config.agentPath } : {}),
    ...(config.defaultCwd ? { defaultCwd: config.defaultCwd } : {}),
  });

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, runner);
    } catch (error) {
      sendJson(res, 500, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: "server_error",
          code: "internal_error",
        },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, resolve);
    server.once("error", reject);
  });

  return server;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  runner: CursorRunner,
) {
  setCors(res);
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "127.0.0.1"}`,
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      provider: "cursor-agent-bridge",
      version: packageVersion,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const models = await runner.listModels();
    const wantsCodexCatalog =
      url.searchParams.has("client_version") ||
      url.searchParams.get("format") === "codex";
    sendJson(
      res,
      200,
      wantsCodexCatalog
        ? toCodexModelCatalog(models)
        : toOpenAIModelList(models),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    await handleChat(req, res, runner);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    await handleResponses(req, res, runner);
    return;
  }

  sendJson(res, 404, {
    error: {
      message: "Not found",
      type: "invalid_request_error",
      code: "not_found",
    },
  });
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  runner: CursorRunner,
) {
  const body = (await readJson(req)) as ChatCompletionRequest;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(res, 400, {
      error: {
        message: "messages is required and must be a non-empty array",
        type: "invalid_request_error",
        code: "invalid_messages",
      },
    });
    return;
  }

  const model = normalizeModel(body.model);
  const prompt = messagesToPrompt(body.messages);
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  if (body.stream === true) {
    const id = `chatcmpl-${randomUUID().replaceAll("-", "")}`;
    writeSseHeaders(res);
    let isFirst = true;
    let lastModel = model;
    await runner.run(
      { model, prompt, signal: abort.signal },
      {
        onDelta: (text) => {
          res.write(
            `data: ${JSON.stringify(createChatChunk(id, lastModel, text, isFirst))}\n\n`,
          );
          isFirst = false;
        },
        onModel: (nextModel) => {
          lastModel = nextModel;
        },
      },
    );
    res.write(
      `data: ${JSON.stringify(createChatDoneChunk(id, lastModel))}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const result = await runner.run({ model, prompt, signal: abort.signal });
  sendJson(res, 200, createChatResponse(result.model, result.text));
}

async function handleResponses(
  req: IncomingMessage,
  res: ServerResponse,
  runner: CursorRunner,
) {
  const body = (await readJson(req)) as ResponsesRequest;
  const model = normalizeModel(body.model);
  const prompt = messagesToPrompt(responsesToMessages(body));
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  const result = await runner.run({ model, prompt, signal: abort.signal });

  if (body.stream === false) {
    sendJson(res, 200, createResponseObject(result.model, result.text));
    return;
  }

  writeSseHeaders(res);
  for (const [event, data] of responseTextEvents(result.model, result.text)) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
  }
  res.end();
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function writeSseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  /* v8 ignore next -- this is a last-resort guard for errors after SSE headers. */
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
