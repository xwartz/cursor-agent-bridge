import { execFile, spawn } from "node:child_process";
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
  modelListCacheMs?: number;
  maxConcurrentRuns?: number;
  yolo?: boolean;
}

type RunPermit = () => void;
const defaultMaxConcurrentRuns = 1;
const forceKillDelayMs = 1_000;

export class CursorRunner {
  readonly agentPath: string;
  readonly defaultCwd: string;
  readonly timeoutMs: number;
  readonly modelListCacheMs: number;
  readonly maxConcurrentRuns: number;
  readonly yolo: boolean;
  private modelCache?: { expiresAt: number; models: BridgeModel[] };
  private activeRuns = 0;
  private readonly runQueue: Array<() => void> = [];
  private readonly activeChildren = new Set<ReturnType<typeof spawn>>();

  constructor(options: CursorRunnerOptions = {}) {
    this.agentPath =
      options.agentPath ?? process.env.CURSOR_AGENT_PATH ?? "agent";
    this.defaultCwd = options.defaultCwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.modelListCacheMs = options.modelListCacheMs ?? 60_000;
    this.maxConcurrentRuns = parsePositiveInteger(
      options.maxConcurrentRuns ??
        Number(
          process.env.CURSOR_AGENT_MAX_CONCURRENT || defaultMaxConcurrentRuns,
        ),
      defaultMaxConcurrentRuns,
    );
    this.yolo = options.yolo ?? process.env.CURSOR_AGENT_YOLO !== "0";
  }

  async listModels(
    options: { refresh?: boolean } = {},
  ): Promise<BridgeModel[]> {
    const now = Date.now();
    if (
      !options.refresh &&
      this.modelCache &&
      this.modelCache.expiresAt > now
    ) {
      return this.modelCache.models;
    }

    const models = await new Promise<BridgeModel[]>((resolve, reject) => {
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
    this.modelCache = { expiresAt: now + this.modelListCacheMs, models };
    return models;
  }

  async run(
    options: CursorRunOptions,
    events: CursorRunEvents = {},
  ): Promise<CursorRunResult> {
    const release = await this.acquireRunPermit(options.signal);
    try {
      if (options.signal?.aborted) throw new Error("Request aborted");
      return await this.runWithPermit(options, events);
    } finally {
      release();
    }
  }

  abortAll() {
    for (const child of this.activeChildren) terminateChild(child);
  }

  private acquireRunPermit(signal?: AbortSignal): Promise<RunPermit> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Request aborted"));
        return;
      }

      let queuedAcquire: (() => void) | undefined;
      const onAbort = () => {
        if (queuedAcquire) {
          this.runQueue.splice(this.runQueue.indexOf(queuedAcquire), 1);
        }
        reject(new Error("Request aborted"));
      };
      const acquire = () => {
        signal?.removeEventListener("abort", onAbort);
        this.activeRuns += 1;
        resolve(() => {
          this.activeRuns -= 1;
          const next = this.runQueue.shift();
          if (next) next();
        });
      };

      if (this.activeRuns < this.maxConcurrentRuns) {
        acquire();
        return;
      }

      queuedAcquire = acquire;
      signal?.addEventListener("abort", onAbort, { once: true });
      this.runQueue.push(acquire);
    });
  }

  private runWithPermit(
    options: CursorRunOptions,
    events: CursorRunEvents,
  ): Promise<CursorRunResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
      ];
      if (this.yolo) args.push("--yolo");
      if (options.model !== "auto") args.push("--model", options.model);

      const child = spawn(this.agentPath, args, {
        cwd: options.cwd ?? this.defaultCwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.activeChildren.add(child);

      let buffer = "";
      let lastModel = options.model;
      let lastAssistantText = "";
      let finalText: string | undefined;
      let stderr = "";
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const timer = setTimeout(() => {
        forceKillTimer = terminateChild(child);
        settle(() =>
          reject(
            new Error(
              `Cursor Agent request timed out after ${this.timeoutMs}ms`,
            ),
          ),
        );
      }, this.timeoutMs);

      const onAbort = () => {
        forceKillTimer = terminateChild(child);
        settle(() => reject(new Error("Request aborted")));
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer && child.exitCode !== null)
          clearTimeout(forceKillTimer);
        options.signal?.removeEventListener("abort", onAbort);
        this.activeChildren.delete(child);
        fn();
      };

      options.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdin.write(options.prompt);
      child.stdin.end();

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() as string;
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

function parsePositiveInteger(value: number, fallback: number) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function terminateChild(child: ReturnType<typeof spawn>) {
  child.kill("SIGTERM");
  return setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, forceKillDelayMs);
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
