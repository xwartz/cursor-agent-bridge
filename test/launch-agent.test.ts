import { afterEach, describe, expect, it, vi } from "vitest";
import { createLaunchAgentPlist } from "../src/launch-agent.js";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

describe("LaunchAgent plist", () => {
  it("runs the bridge with localhost defaults", () => {
    const plist = createLaunchAgentPlist({
      cliPath: "/opt/bin/cursor-agent-bridge",
    });

    expect(plist).toContain("<string>com.xwartz.cursor-agent-bridge</string>");
    expect(plist).toContain("<string>/opt/bin/cursor-agent-bridge</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>127.0.0.1</string>");
    expect(plist).toContain("<string>4646</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("escapes XML-sensitive values", () => {
    const plist = createLaunchAgentPlist({
      cliPath: "/tmp/cursor-agent-bridge",
      agentPath: "/tmp/agent&<test>",
    });

    expect(plist).toContain("/tmp/agent&amp;&lt;test&gt;");
  });

  it("installs through launchctl on macOS", async () => {
    const execFileSync = vi.fn((command: string, args: string[]) => {
      if (command === "launchctl" && args[0] === "bootout") {
        throw new Error("not loaded");
      }
      return "";
    });
    const existsSync = vi.fn(() => true);
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();
    const chmodSync = vi.fn();

    mockPlatform("darwin");
    vi.doMock("node:child_process", () => ({ execFileSync }));
    vi.doMock("node:fs", () => ({
      chmodSync,
      existsSync,
      mkdirSync,
      rmSync: vi.fn(),
      writeFileSync,
    }));
    vi.doMock("node:os", () => ({ homedir: () => "/Users/test" }));

    const { installLaunchAgent } = await import("../src/launch-agent.js");
    const paths = installLaunchAgent({
      cliPath: "/opt/bin/cursor-agent-bridge",
      agentPath: "/opt/bin/agent",
      label: "com.test.bridge",
    });

    expect(paths.plistPath).toBe(
      "/Users/test/Library/LaunchAgents/com.test.bridge.plist",
    );
    expect(mkdirSync).toHaveBeenCalledWith("/Users/test/Library/LaunchAgents", {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      paths.plistPath,
      expect.stringContaining("<string>/opt/bin/agent</string>"),
    );
    expect(chmodSync).toHaveBeenCalledWith(paths.plistPath, 0o644);
    expect(execFileSync).toHaveBeenCalledWith(
      "launchctl",
      ["bootstrap", expect.stringMatching(/^gui\//), paths.plistPath],
      { stdio: "pipe" },
    );
  });

  it("uninstalls and removes the LaunchAgent plist", async () => {
    const execFileSync = vi.fn();
    const rmSync = vi.fn();

    mockPlatform("darwin");
    vi.doMock("node:child_process", () => ({ execFileSync }));
    vi.doMock("node:fs", () => ({
      chmodSync: vi.fn(),
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      rmSync,
      writeFileSync: vi.fn(),
    }));
    vi.doMock("node:os", () => ({ homedir: () => "/Users/test" }));

    const { uninstallLaunchAgent } = await import("../src/launch-agent.js");
    const paths = uninstallLaunchAgent("com.test.bridge");

    expect(execFileSync).toHaveBeenCalledWith(
      "launchctl",
      ["bootout", expect.stringMatching(/^gui\//), paths.plistPath],
      { stdio: "pipe" },
    );
    expect(rmSync).toHaveBeenCalledWith(paths.plistPath, { force: true });
  });

  it("prints LaunchAgent status", async () => {
    const execFileSync = vi.fn(() => "state = running\n");

    mockPlatform("darwin");
    vi.doMock("node:child_process", () => ({ execFileSync }));
    vi.doMock("node:fs", () => ({
      chmodSync: vi.fn(),
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      rmSync: vi.fn(),
      writeFileSync: vi.fn(),
    }));
    vi.doMock("node:os", () => ({ homedir: () => "/Users/test" }));

    const { printLaunchAgentStatus } = await import("../src/launch-agent.js");

    expect(printLaunchAgentStatus("com.test.bridge")).toBe("state = running\n");
    expect(execFileSync).toHaveBeenCalledWith(
      "launchctl",
      ["print", expect.stringMatching(/^gui\/.*\/com\.test\.bridge$/)],
      { encoding: "utf8" },
    );
  });

  it("rejects LaunchAgent management outside macOS", async () => {
    mockPlatform("linux");
    const { installLaunchAgent } = await import("../src/launch-agent.js");

    expect(() =>
      installLaunchAgent({ cliPath: "/opt/bin/cursor-agent-bridge" }),
    ).toThrow("LaunchAgent management is only available on macOS.");
  });
});

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}
