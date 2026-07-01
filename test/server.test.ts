import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import packageJson from "../package.json" with { type: "json" }
import { startServer } from "../src/server.js"
import type { ServerConfig } from "../src/types.js"
import { createFakeAgent, readJson } from "./helpers.js"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function startFakeServer(
  script: string,
  config: Omit<ServerConfig, "agentPath" | "host" | "port"> = {},
) {
  const agentPath = await createFakeAgent(script)
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    agentPath,
    ...config,
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("No server address")
  return `http://127.0.0.1:${address.port}`
}

async function startFakeServerWithDefaults(script: string) {
  const agentPath = await createFakeAgent(script)
  const previousPort = process.env.PORT
  const previousHost = process.env.HOST
  process.env.PORT = "0"
  process.env.HOST = "127.0.0.1"
  const server = await startServer({ agentPath, defaultCwd: process.cwd() })
  if (previousPort === undefined) {
    delete process.env.PORT
  } else {
    process.env.PORT = previousPort
  }
  if (previousHost === undefined) {
    delete process.env.HOST
  } else {
    process.env.HOST = previousHost
  }
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("No server address")
  return `http://127.0.0.1:${address.port}`
}

const okAgent = `#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.log("Available models\\n\\nauto - Auto\\ncomposer-2.5-fast - Composer 2.5 Fast");
  process.exit(0);
}
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system", model: "composer-2.5-fast" }));
  console.log("progress");
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }));
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`

describe("server", () => {
  it("serves health and CORS preflight", async () => {
    const baseUrl = await startFakeServer(okAgent)

    await expect(
      readJson(await fetch(`${baseUrl}/health`)),
    ).resolves.toMatchObject({
      status: "ok",
      provider: "cursor-agent-bridge",
      version: packageJson.version,
    })

    const options = await fetch(`${baseUrl}/v1/models`, { method: "OPTIONS" })
    expect(options.status).toBe(204)
    expect(options.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("uses environment defaults when config does not provide port and host", async () => {
    const baseUrl = await startFakeServerWithDefaults(okAgent)

    await expect(
      readJson(await fetch(`${baseUrl}/health`)),
    ).resolves.toMatchObject({
      status: "ok",
    })
  })

  it("serves OpenAI and Codex model lists", async () => {
    const baseUrl = await startFakeServer(okAgent)

    const openai = await readJson(await fetch(`${baseUrl}/v1/models`))
    expect(openai).toMatchObject({ object: "list" })

    const codex = await readJson(
      await fetch(`${baseUrl}/v1/models?client_version=0.142.4`),
    )
    expect((codex.models as Array<Record<string, unknown>>)[1]).toMatchObject({
      slug: "composer-2.5-fast",
      display_name: "Composer 2.5 Fast",
    })

    const explicitCodex = await readJson(
      await fetch(`${baseUrl}/v1/models?format=codex`),
    )
    expect(explicitCodex).toHaveProperty("models")

    const codexDesktop = await readJson(
      await fetch(`${baseUrl}/v1/models`, {
        headers: {
          "user-agent": "Codex Desktop/0.142.5 (Mac OS 26.5.1; arm64)",
        },
      }),
    )
    expect(codexDesktop).toHaveProperty("models")
  })

  it("caches model lists and supports explicit refresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cursor-agent-model-cache-"))
    const countPath = join(dir, "count.txt")
    await writeFile(countPath, "0")
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const countPath = ${JSON.stringify(countPath)};
if (process.argv.includes("--list-models")) {
  const count = Number(readFileSync(countPath, "utf8")) + 1;
  writeFileSync(countPath, String(count));
  console.log("auto - Auto");
  process.exit(0);
}
`)

    expect((await fetch(`${baseUrl}/v1/models`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/v1/models`)).status).toBe(200)
    expect(await readFile(countPath, "utf8")).toBe("1")

    expect((await fetch(`${baseUrl}/v1/models?refresh=1`)).status).toBe(200)
    expect(await readFile(countPath, "utf8")).toBe("2")
  })

  it("handles non-streaming chat completions", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "cursor/composer-2.5-fast",
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    })
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.choices).toMatchObject([{ message: { content: "OK" } }])
  })

  it("handles streaming chat completions", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        stream: true,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    })
    const body = await response.text()

    expect(body).toContain("chat.completion.chunk")
    expect(body).toContain("[DONE]")
  })

  it("streams chat completions when Cursor Agent only emits a final result", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`)
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        stream: true,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    })
    const body = await response.text()

    expect(body).toContain('"content":"OK"')
    expect(body).toContain("[DONE]")
  })

  it("closes streaming chat completions with an SSE error on runner failures", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) process.exit(0);
console.error("run failed");
process.exit(4);
`)
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        stream: true,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain("event: error")
    expect(body).toContain("run failed")
  })

  it("validates chat messages", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [] }),
    })

    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "invalid_messages" },
    })
  })

  it("handles non-streaming and streaming Responses API requests", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const nonStream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: false }),
    })
    const nonStreamJson = await readJson(nonStream)

    expect(nonStreamJson).toMatchObject({
      object: "response",
      status: "completed",
    })

    const stream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: true }),
    })
    const streamBody = await stream.text()

    expect(streamBody).toContain("event: response.completed")
    expect(streamBody).toContain('"type":"response.completed"')
  })

  it("accepts an empty Responses API request body", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain("response.completed")
  })

  it("streams Responses API deltas before the Cursor Agent process exits", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "O" }] } }));
  setTimeout(() => {
    console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }));
    console.log(JSON.stringify({ type: "result", result: "OK" }));
  }, 250);
});
`)
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: true }),
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")
    const decoder = new TextDecoder()
    let body = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      body += decoder.decode(value, { stream: true })
      if (body.includes('"delta":"O"')) break
    }
    await reader.cancel()

    expect(body).toContain("event: response.output_text.delta")
    expect(body).toContain('"delta":"O"')
    expect(body).not.toContain("response.completed")
  })

  it("streams Responses API final results when no assistant delta was emitted", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system", model: "composer-2.5-fast" }));
  console.log(JSON.stringify({ type: "result", result: "OK" }));
});
`)
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: true }),
    })
    const body = await response.text()

    expect(body).toContain('"delta":"OK"')
    expect(body).toContain('"model":"composer-2.5-fast"')
    expect(body).toContain("event: response.completed")
  })

  it("closes streaming Responses API requests with an SSE error on failures", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) process.exit(0);
console.error("run failed");
process.exit(4);
`)
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: true }),
    })
    const body = await response.text()

    expect(body).toContain("event: error")
    expect(body).toContain("run failed")
  })

  it("streams Responses API requests by default", async () => {
    const baseUrl = await startFakeServer(okAgent)
    const stream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK" }),
    })

    expect(await stream.text()).toContain("event: response.completed")
  })

  it("maps Cursor Agent failures to server errors", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.error("list failed");
  process.exit(3);
}
console.error("run failed");
process.exit(4);
`)

    const models = await fetch(`${baseUrl}/v1/models`)
    expect(models.status).toBe(500)

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: false }),
    })
    expect(response.status).toBe(500)
  })

  it("returns not found and invalid JSON errors", async () => {
    const baseUrl = await startFakeServer(okAgent)

    await expect(
      readJson(await fetch(`${baseUrl}/missing`)),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    })

    const invalid = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })

    expect(invalid.status).toBe(400)
    await expect(readJson(invalid)).resolves.toMatchObject({
      error: { code: "invalid_json" },
    })
  })

  it("rejects request bodies above the configured limit", async () => {
    const baseUrl = await startFakeServer(okAgent, { maxBodyBytes: 8 })
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "too large" }),
    })

    expect(response.status).toBe(413)
    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    })
  })
})
