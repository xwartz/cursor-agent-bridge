import { describe, expect, it } from "vitest";
import { CursorRunner } from "../src/cursor/runner.js";
import { createFakeAgent } from "./helpers.js";

describe("CursorRunner", () => {
  it("uses environment and process defaults", () => {
    const previous = process.env.CURSOR_AGENT_PATH;
    process.env.CURSOR_AGENT_PATH = "env-agent";
    const runner = new CursorRunner();

    expect(runner.agentPath).toBe("env-agent");
    expect(runner.defaultCwd).toBe(process.cwd());
    expect(runner.timeoutMs).toBe(300_000);

    if (previous === undefined) {
      delete process.env.CURSOR_AGENT_PATH;
    } else {
      process.env.CURSOR_AGENT_PATH = previous;
    }
  });

  it("lists models through Cursor Agent", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("Available models\\n\\nauto - Auto\\ncomposer-2.5-fast - Composer 2.5 Fast");
  process.exit(0);
}
`);

    await expect(new CursorRunner({ agentPath }).listModels()).resolves.toEqual(
      [
        { id: "auto", name: "Auto" },
        { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },
      ],
    );
  });

  it("rejects when model listing fails", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
process.exit(9);
`);

    await expect(
      new CursorRunner({ agentPath }).listModels(),
    ).rejects.toBeTruthy();
  });

  it("runs prompts and emits deltas", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system", model: "composer-2.5-fast" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "O" }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }));
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`);
    const deltas: string[] = [];

    const result = await new CursorRunner({ agentPath }).run(
      { model: "auto", prompt: "hi" },
      { onDelta: (text) => deltas.push(text) },
    );

    expect(result).toEqual({ model: "composer-2.5-fast", text: "OK" });
    expect(deltas).toEqual(["O", "K"]);
  });

  it("passes explicit models and reports stderr failures", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
if (process.argv.includes("--model") && process.argv.includes("bad-model")) {
  console.error("bad model");
  process.exit(2);
}
`);

    await expect(
      new CursorRunner({ agentPath }).run({ model: "bad-model", prompt: "hi" }),
    ).rejects.toThrow("bad model");
  });

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
`);

    await expect(
      new CursorRunner({ agentPath }).run({ model: "auto", prompt: "hi" }),
    ).resolves.toEqual({
      model: "auto",
      text: "NO",
    });
  });

  it("rejects process spawn failures", async () => {
    await expect(
      new CursorRunner({ agentPath: "/missing/agent" }).run({
        model: "auto",
        prompt: "hi",
      }),
    ).rejects.toThrow();
  });

  it("times out long running requests", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {}, 10000);
`);

    await expect(
      new CursorRunner({ agentPath, timeoutMs: 5 }).run({
        model: "auto",
        prompt: "hi",
      }),
    ).rejects.toThrow("timed out");
  });

  it("aborts running requests", async () => {
    const agentPath = await createFakeAgent(`#!/usr/bin/env node
setTimeout(() => {}, 10000);
`);
    const abort = new AbortController();
    const promise = new CursorRunner({ agentPath }).run({
      model: "auto",
      prompt: "hi",
      signal: abort.signal,
    });

    abort.abort();

    await expect(promise).rejects.toThrow("Request aborted");
  });
});
