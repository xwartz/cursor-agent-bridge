#!/usr/bin/env node

import {
  installLaunchAgent,
  printLaunchAgentStatus,
  uninstallLaunchAgent,
} from "./launch-agent.js";
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
  cursor-agent-bridge launch-agent install [--host 127.0.0.1] [--port 4646] [--agent-path agent]
  cursor-agent-bridge launch-agent uninstall
  cursor-agent-bridge launch-agent status

Environment:
  HOST                Listen host, default 127.0.0.1
  PORT                Listen port, default 4646
  CURSOR_AGENT_PATH   Cursor Agent CLI path, default agent
`);
  process.exit(0);
}

if (command === "launch-agent") {
  const action = process.argv[3] ?? "status";
  try {
    if (action === "install") {
      const host = readArg("--host", process.env.HOST) ?? "127.0.0.1";
      const port = Number(readArg("--port", process.env.PORT) ?? 4646);
      const agentPath = readArg("--agent-path", process.env.CURSOR_AGENT_PATH);
      const paths = installLaunchAgent({
        cliPath: process.argv[1] ?? "cursor-agent-bridge",
        host,
        port,
        ...(agentPath ? { agentPath } : {}),
      });
      console.log(`Installed ${paths.label}`);
      console.log(paths.plistPath);
      process.exit(0);
    }

    if (action === "uninstall") {
      const paths = uninstallLaunchAgent();
      console.log(`Uninstalled ${paths.label}`);
      process.exit(0);
    }

    if (action === "status") {
      process.stdout.write(printLaunchAgentStatus());
      process.exit(0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.error(`Unknown launch-agent action: ${action}`);
  process.exit(1);
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
