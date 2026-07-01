import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ExecFileFn, SpawnFn } from "../src/upgrade.js";
import {
  buildInstallCommand,
  compareSemver,
  detectPackageManager,
  fetchLatestVersion,
  runUpgrade,
} from "../src/upgrade.js";

describe("compareSemver", () => {
  it("orders patch versions", () => {
    expect(compareSemver("0.1.1", "0.1.2")).toBe(-1);
    expect(compareSemver("0.1.2", "0.1.2")).toBe(0);
    expect(compareSemver("0.1.3", "0.1.2")).toBe(1);
  });

  it("orders minor and major versions", () => {
    expect(compareSemver("0.1.9", "0.2.0")).toBe(-1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
  });
});

describe("fetchLatestVersion", () => {
  it("reads the version field from the npm registry", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;

    await expect(fetchLatestVersion({ fetchFn })).resolves.toBe("0.1.3");
  });

  it("rejects non-ok registry responses", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchLatestVersion({ fetchFn })).rejects.toThrow(
      "Registry returned 503",
    );
  });

  it("rejects responses without a version field", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchLatestVersion({ fetchFn })).rejects.toThrow(
      "Registry response missing version",
    );
  });
});

describe("detectPackageManager", () => {
  it("returns explicit npm or pnpm preferences", async () => {
    const execFileFn = vi.fn();

    await expect(detectPackageManager("npm", execFileFn)).resolves.toBe("npm");
    await expect(detectPackageManager("pnpm", execFileFn)).resolves.toBe(
      "pnpm",
    );
    expect(execFileFn).not.toHaveBeenCalled();
  });

  it("falls back to npm when pnpm is unavailable", async () => {
    const execFileFn = vi.fn<ExecFileFn>(async () => {
      throw new Error("not found");
    });

    await expect(detectPackageManager("auto", execFileFn)).resolves.toBe("npm");
  });

  it("prefers pnpm when it manages the global package", async () => {
    const execFileFn = vi.fn<ExecFileFn>(async (_command, args) => {
      if (args?.[0] === "pnpm") return "";
      return "";
    });

    await expect(detectPackageManager("auto", execFileFn)).resolves.toBe(
      "pnpm",
    );
    expect(execFileFn).toHaveBeenCalledWith("which", ["pnpm"]);
    expect(execFileFn).toHaveBeenCalledWith(
      "pnpm",
      ["list", "-g", "cursor-agent-bridge", "--json"],
      { env: process.env },
    );
  });

  it("falls back to npm when pnpm exists but does not manage the package", async () => {
    const execFileFn = vi.fn<ExecFileFn>(async (command) => {
      if (command === "pnpm") {
        throw new Error("not installed with pnpm");
      }
      return "";
    });

    await expect(detectPackageManager("auto", execFileFn)).resolves.toBe("npm");
  });
});

describe("buildInstallCommand", () => {
  it("builds pnpm and npm install commands", () => {
    expect(buildInstallCommand("pnpm", "latest")).toEqual({
      command: "pnpm",
      args: ["add", "-g", "cursor-agent-bridge@latest"],
    });
    expect(buildInstallCommand("npm", "0.1.3")).toEqual({
      command: "npm",
      args: ["install", "-g", "cursor-agent-bridge@0.1.3"],
    });
  });
});

describe("runUpgrade", () => {
  function createSpawnMock(exitCode: number): SpawnFn {
    return () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", exitCode));
      return child;
    };
  }

  it("reports up to date in check mode with exit code 0", async () => {
    const logs: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.2" }),
    })) as unknown as typeof fetch;

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      checkOnly: true,
      fetchFn,
      log: (...args) => logs.push(String(args[0])),
    });

    expect(exitCode).toBe(0);
    expect(logs).toContain("cursor-agent-bridge is up to date (0.1.2)");
  });

  it("reports available updates in check mode with exit code 1", async () => {
    const logs: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      checkOnly: true,
      fetchFn,
      log: (...args) => logs.push(String(args[0])),
    });

    expect(exitCode).toBe(1);
    expect(logs).toContain("Update available: 0.1.2 -> 0.1.3");
  });

  it("installs through the selected package manager", async () => {
    const logs: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;
    const execFileFn = vi.fn(async () => "");
    const spawnFn = vi.fn(createSpawnMock(0));

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      manager: "pnpm",
      fetchFn,
      execFileFn,
      spawnFn,
      existsFn: () => false,
      log: (...args) => logs.push(String(args[0])),
    });

    expect(exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "cursor-agent-bridge@latest"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(logs).toContain("Installed cursor-agent-bridge@0.1.3");
  });

  it("installs an explicit target without querying the registry", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const execFileFn = vi.fn(async () => "");
    const spawnFn = vi.fn(createSpawnMock(0));

    const exitCode = await runUpgrade({
      currentVersion: "0.1.1",
      target: "0.1.2",
      manager: "npm",
      fetchFn,
      execFileFn,
      spawnFn,
      existsFn: () => false,
    });

    expect(exitCode).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(spawnFn).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "cursor-agent-bridge@0.1.2"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("prints a LaunchAgent hint when the plist exists", async () => {
    const logs: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;
    const execFileFn = vi.fn(async () => "");
    const spawnFn = vi.fn(createSpawnMock(0));

    await runUpgrade({
      currentVersion: "0.1.2",
      manager: "npm",
      fetchFn,
      execFileFn,
      spawnFn,
      existsFn: () => true,
      log: (...args) => logs.push(String(args[0])),
    });

    expect(logs).toContain(
      "LaunchAgent detected. Run `cursor-agent-bridge launch-agent install` to refresh the service.",
    );
  });

  it("returns exit code 1 when the registry is unreachable", async () => {
    const errors: string[] = [];
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      checkOnly: true,
      fetchFn,
      errorLog: (...args) => errors.push(String(args[0])),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("Failed to check for updates: network down");
    expect(errors).toContain("Upgrade manually:");
  });

  it("formats non-error registry failures", async () => {
    const errors: string[] = [];
    const fetchFn = vi.fn(async () => {
      throw "offline";
    }) as unknown as typeof fetch;

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      checkOnly: true,
      fetchFn,
      errorLog: (...args) => errors.push(String(args[0])),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("Failed to check for updates: offline");
  });

  it("returns exit code 1 when spawn fails before install starts", async () => {
    const errors: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;
    const execFileFn = vi.fn(async () => "");
    const spawnFn: SpawnFn = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
      return child;
    };

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      manager: "npm",
      fetchFn,
      execFileFn,
      spawnFn,
      existsFn: () => false,
      errorLog: (...args) => errors.push(String(args[0])),
    });

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain("Install failed: spawn EACCES");
    expect(errors).toContain("Upgrade manually:");
  });

  it("returns the install exit code when the package manager fails", async () => {
    const errors: string[] = [];
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.3" }),
    })) as unknown as typeof fetch;
    const execFileFn = vi.fn(async () => "");
    const spawnFn = vi.fn(createSpawnMock(2));

    const exitCode = await runUpgrade({
      currentVersion: "0.1.2",
      manager: "npm",
      fetchFn,
      execFileFn,
      spawnFn,
      existsFn: () => false,
      errorLog: (...args) => errors.push(String(args[0])),
    });

    expect(exitCode).toBe(2);
    expect(errors).toContain("npm install failed with exit code 2");
  });
});
