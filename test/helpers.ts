import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createFakeAgent(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "cursor-agent-bridge-"));
  const path = join(dir, "agent.mjs");
  await writeFile(path, script, { mode: 0o755 });
  return path;
}

export async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}
