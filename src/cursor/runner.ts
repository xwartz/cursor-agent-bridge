import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { parseAgentModelList } from "../adapter/models.js";
import type {
  BridgeModel,
  CursorRunEvents,
  CursorRunOptions,
  CursorRunResult,
} from "../types.js";

export interface CursorRunnerOptions {
  agentPath?: string;
  defaultCwd?: string;
  timeoutMs?: number;
}

export class CursorRunner extends EventEmitter {
  readonly agentPath: string;
  readonly defaultCwd: string;
  readonly timeoutMs: number;

  constructor(options: CursorRunnerOptions = {}) {
    super();
    this.agentPath =
      options.agentPath ?? process.env.CURSOR_AGENT_PATH ?? "agent";
    this.defaultCwd = options.defaultCwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  listModels(): Promise<BridgeModel[]> {
    return new Promise((resolve, reject) => {
      execFile(
        this.agentPath,
        ["--list-models"],
        { timeout: 30_000 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(parseAgentModelList(stdout));
        },
      );
    });
  }

  run(
    options: CursorRunOptions,
    events: CursorRunEvents = {},
  ): Promise<CursorRunResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--yolo",
      ];
      if (options.model !== "auto") args.push("--model", options.model);

      const child = spawn(this.agentPath, args, {
        cwd: options.cwd ?? this.defaultCwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";
      let lastModel = options.model;
      let lastAssistantText = "";
      let finalText: string | undefined;
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(`Cursor Agent request timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      options.signal?.addEventListener("abort", () => {
        child.kill("SIGTERM");
        settle(() => reject(new Error("Request aborted")));
      });

      child.stdin.write(options.prompt);
      child.stdin.end();

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const message = JSON.parse(trimmed) as Record<string, unknown>;
            if (typeof message.model === "string") {
              lastModel = message.model;
              events.onModel?.(lastModel);
            }

            const text = extractAssistantText(message);
            if (text && text !== lastAssistantText) {
              const delta = text.startsWith(lastAssistantText)
                ? text.slice(lastAssistantText.length)
                : text;
              lastAssistantText = text;
              events.onDelta?.(delta);
            }

            if (typeof message.result === "string") finalText = message.result;
          } catch {
            // Cursor occasionally emits non-JSON progress lines. They are not protocol data.
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        settle(() => reject(error));
      });

      child.on("close", (code) => {
        settle(() => {
          if (code === 0 && (finalText !== undefined || lastAssistantText)) {
            resolve({ text: finalText ?? lastAssistantText, model: lastModel });
            return;
          }
          reject(
            new Error(stderr.trim() || `Cursor Agent exited with code ${code}`),
          );
        });
      });
    });
  }
}

function extractAssistantText(message: Record<string, unknown>): string {
  const nested = message.message;
  if (!nested || typeof nested !== "object") return "";
  const content = (nested as Record<string, unknown>).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}
