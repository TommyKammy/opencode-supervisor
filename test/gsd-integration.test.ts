import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentPrompt } from "../src/agent/agent";
import { Supervisor } from "../src/core/supervisor";

const BASE_CONFIG = {
  repoPath: "/tmp/repo",
  repoSlug: "owner/repo",
  defaultBranch: "main",
  workspaceRoot: "/tmp/workspaces",
  stateFile: "/tmp/state.json",
  branchPrefix: "opencode/issue-",
};

async function withTempConfig(
  payload: Record<string, unknown>,
  run: (configPath: string) => Promise<void> | void,
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gsd-test-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  const stateDir = path.join(tempDir, ".local");
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        ...BASE_CONFIG,
        repoPath: tempDir,
        workspaceRoot: path.join(tempDir, "workspaces"),
        stateFile: path.join(stateDir, "state.json"),
        ...payload,
      }),
      "utf8",
    );
    await run(configPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("buildAgentPrompt injects GSD guidance when enabled", () => {
  const prompt = buildAgentPrompt({
    repoSlug: "owner/repo",
    issue: {
      number: 11,
      title: "Issue title",
      body: "Issue body",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
      url: "https://example.invalid/issues/11",
    },
    branch: "opencode/issue-11",
    workspacePath: "/tmp/workspaces/issue-11",
    state: "reproducing",
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-11/.opencode-supervisor/issue-journal.md",
    gsdEnabled: true,
    gsdPlanningFiles: ["PROJECT.md", "STATE.md"],
    category: "deep",
    reasoningEffort: "medium",
  });

  assert.match(prompt, /GSD collaboration:/);
  assert.match(prompt, /PROJECT\.md, STATE\.md/);
});

test("buildAgentPrompt omits GSD guidance when disabled", () => {
  const prompt = buildAgentPrompt({
    repoSlug: "owner/repo",
    issue: {
      number: 11,
      title: "Issue title",
      body: "Issue body",
      createdAt: "2026-03-11T00:00:00Z",
      updatedAt: "2026-03-11T00:00:00Z",
      url: "https://example.invalid/issues/11",
    },
    branch: "opencode/issue-11",
    workspacePath: "/tmp/workspaces/issue-11",
    state: "reproducing",
    pr: null,
    checks: [],
    reviewThreads: [],
    alwaysReadFiles: [],
    onDemandMemoryFiles: [],
    journalPath: "/tmp/workspaces/issue-11/.opencode-supervisor/issue-journal.md",
    gsdEnabled: false,
    gsdPlanningFiles: ["PROJECT.md", "STATE.md"],
    category: "deep",
    reasoningEffort: "medium",
  });

  assert.doesNotMatch(prompt, /GSD collaboration:/);
});

test("status output includes explicit disabled GSD status by default", async () => {
  await withTempConfig({}, async (configPath) => {
    const supervisor = Supervisor.fromConfig(configPath);
    const output = await supervisor.status();
    assert.match(output, /^gsd=disabled/m);
  });
});

test("status output includes explicit enabled GSD status details", async () => {
  await withTempConfig(
    {
      gsdEnabled: true,
      gsdAutoInstall: true,
      gsdInstallScope: "local",
      gsdPlanningFiles: ["PROJECT.md", "STATE.md"],
    },
    async (configPath) => {
      const supervisor = Supervisor.fromConfig(configPath);
      const output = await supervisor.status();
      assert.match(output, /^gsd=enabled\b/m);
      assert.match(output, /\bscope=local\b/);
      assert.match(output, /\bauto_install=yes\b/);
      assert.match(output, /\bplanning_files=PROJECT\.md,STATE\.md\b/);
    },
  );
});
