import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
};

async function waitForOutput(buffer: () => string, pattern: RegExp, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(buffer())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for output pattern ${pattern}`);
}

async function createExecutable(filePath: string, body: string): Promise<void> {
  await fs.writeFile(filePath, body, { encoding: "utf8", mode: 0o755 });
}

test("loop mode handles SIGTERM with explicit graceful shutdown output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-loop-shutdown-"));
  try {
    const fakeRepoPath = path.join(tempDir, "repo");
    const fakeWorkspaceRoot = path.join(tempDir, "workspaces");
    const fakeStateFile = path.join(tempDir, "state", "supervisor-state.json");
    const fakeBinDir = path.join(tempDir, "bin");
    const configPath = path.join(tempDir, "supervisor.config.json");

    await fs.mkdir(path.join(fakeRepoPath, ".git"), { recursive: true });
    await fs.mkdir(fakeWorkspaceRoot, { recursive: true });
    await fs.mkdir(fakeBinDir, { recursive: true });

    await createExecutable(path.join(fakeBinDir, "gh"), "#!/usr/bin/env bash\nif [[ \"$1\" == \"auth\" && \"$2\" == \"status\" ]]; then\n  exit 0\nfi\nexit 1\n");
    await createExecutable(path.join(fakeBinDir, "opencode"), "#!/usr/bin/env bash\nif [[ \"$1\" == \"--version\" ]]; then\n  echo \"opencode-test\"\n  exit 0\nfi\nexit 1\n");

    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          repoPath: fakeRepoPath,
          repoSlug: "owner/repo",
          defaultBranch: "main",
          workspaceRoot: fakeWorkspaceRoot,
          stateFile: fakeStateFile,
          branchPrefix: "opencode/issue-",
          pollIntervalSeconds: 60,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/index.ts", "loop", "--config", configPath],
      {
        cwd: path.resolve(__dirname, ".."),
        env: {
          ...process.env,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    await waitForOutput(() => output, /loop-error|Skipped supervisor cycle:/, 10_000);
    child.kill("SIGTERM");
    const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    const result: ChildResult = { code, signal, output };

    assert.equal(result.signal, null);
    assert.equal(result.code, 0);
    assert.match(result.output, /shutdown requested/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
