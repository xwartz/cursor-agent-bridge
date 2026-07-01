#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import {
  installLaunchAgent,
  printLaunchAgentStatus,
  uninstallLaunchAgent,
} from "./launch-agent.js";
import { startServer } from "./server.js";
import { runUpgrade } from "./upgrade.js";

function readArg(name: string, fallback: string | undefined) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("-"))
    throw new Error(`Missing value for ${name}`);
  return value;
}

function parsePort(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
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
  cursor-agent-bridge upgrade [--check] [--target latest] [--manager auto|npm|pnpm]

Environment:
  HOST                Listen host, default 127.0.0.1
  PORT                Listen port, default 4646
  CURSOR_AGENT_PATH   Cursor Agent CLI path, default agent
`);
  process.exit(0);
}

if (command === "version" || process.argv.includes("--version")) {
  console.log(packageJson.version);
  process.exit(0);
}

if (command === "upgrade") {
  const checkOnly = process.argv.includes("--check");
  const target = readArg("--target", "latest") ?? "latest";
  const manager = readArg("--manager", "auto") ?? "auto";

  if (manager !== "auto" && manager !== "npm" && manager !== "pnpm") {
    console.error("Invalid --manager value. Use auto, npm, or pnpm.");
    process.exit(1);
  }

  const exitCode = await runUpgrade({
    currentVersion: packageJson.version,
    checkOnly,
    target,
    manager,
  });
  process.exit(exitCode);
}

if (command === "launch-agent") {
  const action = process.argv[3] ?? "status";
  try {
    if (action === "install") {
      const host = readArg("--host", process.env.HOST) ?? "127.0.0.1";
      const port = parsePort(readArg("--port", process.env.PORT), 4646);
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

let host: string;
let port: number;
try {
  host = readArg("--host", process.env.HOST) ?? "127.0.0.1";
  port = parsePort(readArg("--port", process.env.PORT), 4646);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

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
