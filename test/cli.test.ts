import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const unrunBin = "node_modules/.bin/unrun";

async function runCli(args: string[]) {
  try {
    const result = await execFileAsync(unrunBin, ["src/cli.ts", ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: execError.code ?? 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  }
}

describe("CLI", () => {
  it("prints help with exit code 0", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("cursor-agent-bridge serve");
    expect(result.stdout).toContain("cursor-agent-bridge upgrade");
  });

  it("prints the package version with exit code 0", async () => {
    const result = await runCli(["--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it("rejects invalid serve ports with exit code 1", async () => {
    const result = await runCli(["serve", "--port", "nope"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid port: nope");
  });

  it("rejects missing serve port values with exit code 1", async () => {
    const result = await runCli(["serve", "--port"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Missing value for --port");
  });

  it("rejects invalid LaunchAgent ports with exit code 1 before touching launchctl", async () => {
    const result = await runCli(["launch-agent", "install", "--port", "0"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid port: 0");
  });

  it("rejects unknown commands with exit code 1", async () => {
    const result = await runCli(["missing-command"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command: missing-command");
  });

  it("rejects invalid upgrade manager values with exit code 1", async () => {
    const result = await runCli(["upgrade", "--manager", "yarn"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid --manager value");
  });
});
