import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "../src/server.js";
import { createFakeAgent, readJson } from "./helpers.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function startFakeServer(script: string) {
  const agentPath = await createFakeAgent(script);
  const server = await startServer({ host: "127.0.0.1", port: 0, agentPath });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  return `http://127.0.0.1:${address.port}`;
}

async function startFakeServerWithDefaults(script: string) {
  const agentPath = await createFakeAgent(script);
  const previousPort = process.env.PORT;
  const previousHost = process.env.HOST;
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  const server = await startServer({ agentPath, defaultCwd: process.cwd() });
  if (previousPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = previousPort;
  }
  if (previousHost === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = previousHost;
  }
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  return `http://127.0.0.1:${address.port}`;
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
`;

describe("server", () => {
  it("serves health and CORS preflight", async () => {
    const baseUrl = await startFakeServer(okAgent);

    await expect(
      readJson(await fetch(`${baseUrl}/health`)),
    ).resolves.toMatchObject({
      status: "ok",
      provider: "cursor-agent-bridge",
    });

    const options = await fetch(`${baseUrl}/v1/models`, { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("uses environment defaults when config does not provide port and host", async () => {
    const baseUrl = await startFakeServerWithDefaults(okAgent);

    await expect(
      readJson(await fetch(`${baseUrl}/health`)),
    ).resolves.toMatchObject({
      status: "ok",
    });
  });

  it("serves OpenAI and Codex model lists", async () => {
    const baseUrl = await startFakeServer(okAgent);

    const openai = await readJson(await fetch(`${baseUrl}/v1/models`));
    expect(openai).toMatchObject({ object: "list" });

    const codex = await readJson(
      await fetch(`${baseUrl}/v1/models?client_version=0.142.4`),
    );
    expect((codex.models as Array<Record<string, unknown>>)[1]).toMatchObject({
      slug: "composer-2.5-fast",
      display_name: "Composer 2.5 Fast",
    });

    const explicitCodex = await readJson(
      await fetch(`${baseUrl}/v1/models?format=codex`),
    );
    expect(explicitCodex).toHaveProperty("models");
  });

  it("handles non-streaming chat completions", async () => {
    const baseUrl = await startFakeServer(okAgent);
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "cursor/composer-2.5-fast",
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    });
    const json = await readJson(response);

    expect(response.status).toBe(200);
    expect(json.choices).toMatchObject([{ message: { content: "OK" } }]);
  });

  it("handles streaming chat completions", async () => {
    const baseUrl = await startFakeServer(okAgent);
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        stream: true,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    });
    const body = await response.text();

    expect(body).toContain("chat.completion.chunk");
    expect(body).toContain("[DONE]");
  });

  it("validates chat messages", async () => {
    const baseUrl = await startFakeServer(okAgent);
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [] }),
    });

    await expect(readJson(response)).resolves.toMatchObject({
      error: { code: "invalid_messages" },
    });
  });

  it("handles non-streaming and streaming Responses API requests", async () => {
    const baseUrl = await startFakeServer(okAgent);
    const nonStream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: false }),
    });
    const nonStreamJson = await readJson(nonStream);

    expect(nonStreamJson).toMatchObject({
      object: "response",
      status: "completed",
    });

    const stream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: true }),
    });
    const streamBody = await stream.text();

    expect(streamBody).toContain("event: response.completed");
    expect(streamBody).toContain('"type":"response.completed"');
  });

  it("streams Responses API requests by default", async () => {
    const baseUrl = await startFakeServer(okAgent);
    const stream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK" }),
    });

    expect(await stream.text()).toContain("event: response.completed");
  });

  it("maps Cursor Agent failures to server errors", async () => {
    const baseUrl = await startFakeServer(`#!/usr/bin/env node
if (process.argv.includes("--list-models")) {
  console.error("list failed");
  process.exit(3);
}
console.error("run failed");
process.exit(4);
`);

    const models = await fetch(`${baseUrl}/v1/models`);
    expect(models.status).toBe(500);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", input: "Reply OK", stream: false }),
    });
    expect(response.status).toBe(500);
  });

  it("returns not found and invalid JSON errors", async () => {
    const baseUrl = await startFakeServer(okAgent);

    await expect(
      readJson(await fetch(`${baseUrl}/missing`)),
    ).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    const invalid = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(invalid.status).toBe(500);
    await expect(readJson(invalid)).resolves.toMatchObject({
      error: { code: "internal_error" },
    });
  });
});
