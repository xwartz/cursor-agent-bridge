#!/usr/bin/env node

import { startServer } from "./server.js";

function readArg(name: string, fallback: string | undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command =
  process.argv[2] && !process.argv[2]?.startsWith("-")
    ? process.argv[2]
    : "serve";

if (
  command === "help" ||
  process.argv.includes("--help") ||
  process.argv.includes("-h")
) {
  console.log(`cursor-agent-bridge

Usage:
  cursor-agent-bridge serve [--host 127.0.0.1] [--port 4646]

Environment:
  HOST                Listen host, default 127.0.0.1
  PORT                Listen port, default 4646
  CURSOR_AGENT_PATH   Cursor Agent CLI path, default agent
`);
  process.exit(0);
}

if (command !== "serve") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const host = readArg("--host", process.env.HOST) ?? "127.0.0.1";
const port = Number(readArg("--port", process.env.PORT) ?? 4646);

const server = await startServer({
  host,
  port,
  ...(process.env.CURSOR_AGENT_PATH
    ? { agentPath: process.env.CURSOR_AGENT_PATH }
    : {}),
});
console.log(`cursor-agent-bridge listening on http://${host}:${port}`);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
