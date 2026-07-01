import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const defaultLabel = "com.xwartz.cursor-agent-bridge";
const defaultLogDir = join(homedir(), ".codex", "logs");

export type LaunchAgentOptions = {
  cliPath: string;
  host?: string;
  port?: number;
  agentPath?: string;
  label?: string;
};

export type LaunchAgentPaths = {
  label: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
};

export function getLaunchAgentPaths(label = defaultLabel): LaunchAgentPaths {
  return {
    label,
    plistPath: join(homedir(), "Library", "LaunchAgents", `${label}.plist`),
    stdoutPath: join(defaultLogDir, "cursor-agent-bridge.log"),
    stderrPath: join(defaultLogDir, "cursor-agent-bridge.err.log"),
  };
}

export function createLaunchAgentPlist(options: LaunchAgentOptions) {
  const label = options.label ?? defaultLabel;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4646;
  const paths = getLaunchAgentPaths(label);
  const args = [
    resolve(options.cliPath),
    "serve",
    "--host",
    host,
    "--port",
    String(port),
  ];
  const env: Record<string, string> = {
    PATH: [
      dirname(resolve(options.cliPath)),
      join(homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":"),
  };

  if (options.agentPath) {
    env.CURSOR_AGENT_PATH = options.agentPath;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlist(label)}</string>

  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${escapePlist(arg)}</string>`).join("\n")}
  </array>

  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(
    ([key, value]) =>
      `    <key>${escapePlist(key)}</key>\n    <string>${escapePlist(value)}</string>`,
  )
  .join("\n")}
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${escapePlist(paths.stdoutPath)}</string>

  <key>StandardErrorPath</key>
  <string>${escapePlist(paths.stderrPath)}</string>
</dict>
</plist>
`;
}

export function installLaunchAgent(options: LaunchAgentOptions) {
  ensureMacOS();
  const label = options.label ?? defaultLabel;
  const paths = getLaunchAgentPaths(label);
  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(defaultLogDir, { recursive: true });

  if (existsSync(paths.plistPath)) {
    bootout(paths.plistPath);
  }

  writeFileSync(paths.plistPath, createLaunchAgentPlist(options));
  chmodSync(paths.plistPath, 0o644);
  execFileSync("launchctl", ["bootstrap", launchctlDomain(), paths.plistPath], {
    stdio: "pipe",
  });
  return paths;
}

export function uninstallLaunchAgent(label = defaultLabel) {
  ensureMacOS();
  const paths = getLaunchAgentPaths(label);
  bootout(paths.plistPath);
  rmSync(paths.plistPath, { force: true });
  return paths;
}

export function printLaunchAgentStatus(label = defaultLabel) {
  ensureMacOS();
  return execFileSync("launchctl", ["print", `${launchctlDomain()}/${label}`], {
    encoding: "utf8",
  });
}

function bootout(plistPath: string) {
  try {
    execFileSync("launchctl", ["bootout", launchctlDomain(), plistPath], {
      stdio: "pipe",
    });
  } catch {
    // It is fine if the service is not loaded yet.
  }
}

function launchctlDomain() {
  return `gui/${process.getuid?.() ?? execFileSync("id", ["-u"], { encoding: "utf8" }).trim()}`;
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("LaunchAgent management is only available on macOS.");
  }
}

function escapePlist(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
