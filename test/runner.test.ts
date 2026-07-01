import { describe, expect, it } from "vitest"
import { CursorRunner } from "../src/cursor/runner.js"
import { createFakeAgent } from "./helpers.js"

describe("CursorRunner", () => {
  it("uses environment and process defaults", () => {
    const previous = process.env.CURSOR_AGENT_PATH
    process.env.CURSOR_AGENT_PATH = "env-agent"
    const runner = new CursorRunner()

    expect(runner.agentPath).toBe("env-agent")
    expect(runner.defaultCwd).toBe(process.cwd())
    expect(runner.timeoutMs).toBe(300_000)

    if (previous === undefined) {
      delete process.env.CURSOR_AGENT_PATH
    } else {
      process.env.CURSOR_AGENT_PATH = previous
    }
  })

  it("lists models through Cursor Agent", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("Available models\\n\\nauto - Auto\\ncomposer-2.5-fast - Composer 2.5 Fast");
  process.exit(0);
}
`)

    await expect(new CursorRunner({ agentPath }).listModels()).resolves.toEqual(
      [
        { id: "auto", name: "Auto" },
        { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },
      ],
    )
  })

  it("caches listed models within the configured TTL", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const countPath = process.env.COUNT_PATH;
if (!countPath) process.exit(1);
const count = Number(readFileSync(countPath, "utf8")) + 1;
writeFileSync(countPath, String(count));
console.log("auto - Auto");
`)
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-cache-"))
    const countPath = join(dir, "count.txt")
    await writeFile(countPath, "0")
    const previous = process.env.COUNT_PATH
    process.env.COUNT_PATH = countPath
    const runner = new CursorRunner({ agentPath, modelListCacheMs: 60_000 })

    await runner.listModels()
    await runner.listModels()

    expect(await readFile(countPath, "utf8")).toBe("1")
    await runner.listModels({ refresh: true })
    expect(await readFile(countPath, "utf8")).toBe("2")
    if (previous === undefined) {
      delete process.env.COUNT_PATH
    } else {
      process.env.COUNT_PATH = previous
    }
  })

  it("rejects when model listing fails", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
process.exit(9);
`)

    await expect(
      new CursorRunner({ agentPath }).listModels(),
    ).rejects.toBeTruthy()
  })

  it("runs prompts and emits deltas", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system", model: "composer-2.5-fast" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "O" }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }));
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`)
    const deltas: string[] = []

    const result = await new CursorRunner({ agentPath }).run(
      { model: "auto", prompt: "hi" },
      { onDelta: (text) => deltas.push(text) },
    )

    expect(result).toEqual({ model: "composer-2.5-fast", text: "OK" })
    expect(deltas).toEqual(["O", "K"])
  })

  it("can run without Cursor Agent yolo mode", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--yolo")) {
  console.error("unexpected yolo");
  process.exit(2);
}
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`)

    await expect(
      new CursorRunner({ agentPath, yolo: false }).run({
        model: "auto",
        prompt: "hi",
      }),
    ).resolves.toEqual({ model: "auto", text: "OK" })
  })

  it("limits concurrent runs", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {
  console.log(JSON.stringify({ type: "result", result: "OK" }));
}, 50);
`)
    const runner = new CursorRunner({ agentPath, maxConcurrentRuns: 1 })
    const startedAt = Date.now()

    await Promise.all([
      runner.run({ model: "auto", prompt: "one" }),
      runner.run({ model: "auto", prompt: "two" }),
    ])

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90)
  })

  it("falls back to one concurrent run for invalid environment values", () => {
    const previous = process.env.CURSOR_AGENT_MAX_CONCURRENT
    process.env.CURSOR_AGENT_MAX_CONCURRENT = "not-a-number"

    try {
      const runner = new CursorRunner()

      expect(runner.maxConcurrentRuns).toBe(1)
    } finally {
      if (previous === undefined) {
        delete process.env.CURSOR_AGENT_MAX_CONCURRENT
      } else {
        process.env.CURSOR_AGENT_MAX_CONCURRENT = previous
      }
    }
  })

  it("rejects pre-aborted and queued-aborted requests", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {
  console.log(JSON.stringify({ type: "result", result: "OK" }));
}, 100);
`)
    const runner = new CursorRunner({ agentPath, maxConcurrentRuns: 1 })
    const preAborted = new AbortController()
    preAborted.abort()

    await expect(
      runner.run({
        model: "auto",
        prompt: "pre",
        signal: preAborted.signal,
      }),
    ).rejects.toThrow("Request aborted")

    const first = runner.run({ model: "auto", prompt: "first" })
    const queuedAbort = new AbortController()
    const second = runner.run({
      model: "auto",
      prompt: "second",
      signal: queuedAbort.signal,
    })
    queuedAbort.abort()

    await expect(second).rejects.toThrow("Request aborted")
    await expect(first).resolves.toEqual({ model: "auto", text: "OK" })
  })

  it("passes explicit models and reports stderr failures", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--model") && process.argv.includes("bad-model")) {
  console.error("bad model");
  process.exit(2);
}
`)

    await expect(
      new CursorRunner({ agentPath }).run({ model: "bad-model", prompt: "hi" }),
    ).rejects.toThrow("bad model")
  })

  it("uses assistant text when no result event is emitted", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.log("not json");
  console.log("");
  console.log(JSON.stringify({ type: "assistant", message: { content: "not-array" } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [null, { type: "text", text: 123 }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "NO" }] } }));
});
`)

    await expect(
      new CursorRunner({ agentPath }).run({ model: "auto", prompt: "hi" }),
    ).resolves.toEqual({
      model: "auto",
      text: "NO",
    })
  })

  it("rejects process spawn failures", async () => {
    await expect(
      new CursorRunner({ agentPath: "/missing/agent" }).run({
        model: "auto",
        prompt: "hi",
      }),
    ).rejects.toThrow()
  })

  it("times out long running requests", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {}, 10000);
`)

    await expect(
      new CursorRunner({ agentPath, timeoutMs: 5 }).run({
        model: "auto",
        prompt: "hi",
      }),
    ).rejects.toThrow("timed out")
  })

  it("force-kills processes that ignore termination after timeout", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const pidPath = process.env.PID_PATH;
if (!pidPath) process.exit(1);
writeFileSync(pidPath, String(process.pid));
process.on("SIGTERM", () => {});
setTimeout(() => {}, 10000);
`)
    const { mkdtemp, readFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-kill-"))
    const pidPath = join(dir, "pid.txt")
    const previous = process.env.PID_PATH
    process.env.PID_PATH = pidPath

    try {
      const promise = new CursorRunner({ agentPath, timeoutMs: 5_000 }).run({
        model: "auto",
        prompt: "hi",
      })
      promise.catch(() => {})

      await waitForFile(pidPath)
      await expect(promise).rejects.toThrow("timed out")
      const pid = Number(await readFile(pidPath, "utf8"))
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      if (previous === undefined) {
        delete process.env.PID_PATH
      } else {
        process.env.PID_PATH = previous
      }
    }
  }, 15_000)

  it("aborts running requests", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {}, 10000);
`)
    const abort = new AbortController()
    const promise = new CursorRunner({ agentPath }).run({
      model: "auto",
      prompt: "hi",
      signal: abort.signal,
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    abort.abort()

    await expect(promise).rejects.toThrow("Request aborted")
  })
})

async function waitForFile(path: string) {
  const { access } = await import("node:fs/promises")
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}
