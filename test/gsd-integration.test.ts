import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentPrompt } from "../src/agent/agent";
import { ensureGsdInstalled } from "../src/core/gsd";
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
      assert.match(output, /\binstalled=no\b/);
    },
  );
});

test("status output reports installed=yes when required GSD skills are present", async () => {
  await withTempConfig(
    {
      gsdEnabled: true,
      gsdAutoInstall: true,
      gsdInstallScope: "local",
      gsdPlanningFiles: ["PROJECT.md", "STATE.md"],
    },
    async (configPath) => {
      const configDir = path.join(path.dirname(configPath), ".codex");
      for (const skillName of [
        "gsd-help",
        "gsd-new-project",
        "gsd-discuss-phase",
        "gsd-plan-phase",
        "gsd-execute-phase",
        "gsd-verify-work",
      ]) {
        await fs.mkdir(path.join(configDir, "skills", skillName), { recursive: true });
        await fs.writeFile(path.join(configDir, "skills", skillName, "SKILL.md"), `# ${skillName}\n`, "utf8");
      }

      const supervisor = Supervisor.fromConfig(configPath);
      const output = await supervisor.status();
      assert.match(output, /^gsd=enabled\b/m);
      assert.match(output, /\binstalled=yes\b/);
    },
  );
});

test("ensureGsdInstalled is a no-op when GSD is disabled", async () => {
  await withTempConfig(
    {
      gsdEnabled: false,
      gsdAutoInstall: true,
      gsdInstallScope: "local",
    },
    async (configPath) => {
      const supervisor = Supervisor.fromConfig(configPath);
      const output = await ensureGsdInstalled(supervisor.config);
      assert.equal(output, null);
    },
  );
});

test("ensureGsdInstalled installs required skills when enabled and missing", async () => {
  await withTempConfig(
    {
      gsdEnabled: true,
      gsdAutoInstall: true,
      gsdInstallScope: "local",
      gsdPlanningFiles: ["PROJECT.md", "STATE.md"],
    },
    async (configPath) => {
      const supervisor = Supervisor.fromConfig(configPath);
      const binDir = path.join(path.dirname(configPath), "bin");
      const fakeNpxPath = path.join(binDir, "npx");
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(
        fakeNpxPath,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "codex_dir=\"\"",
          "args=(\"$@\")",
          "for ((i=0; i<${#args[@]}; i++)); do",
          "  if [[ \"${args[$i]}\" == \"--local\" ]]; then",
          "    codex_dir=\"$PWD/.codex\"",
          "  fi",
          "  if [[ \"${args[$i]}\" == \"--config-dir\" ]]; then",
          "    codex_dir=\"${args[$((i+1))]}\"",
          "  fi",
          "done",
          "mkdir -p \"$codex_dir/skills\"",
          "for skill in gsd-help gsd-new-project gsd-discuss-phase gsd-plan-phase gsd-execute-phase gsd-verify-work; do",
          "  mkdir -p \"$codex_dir/skills/$skill\"",
          "  printf \"# %s\\n\" \"$skill\" > \"$codex_dir/skills/$skill/SKILL.md\"",
          "done",
        ].join("\n"),
        "utf8",
      );
      await fs.chmod(fakeNpxPath, 0o755);

      const originalPath = process.env.PATH;
      process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
      try {
        const installMessage = await ensureGsdInstalled(supervisor.config);
        assert.match(installMessage ?? "", /Installed GSD Codex skills/);
      } finally {
        process.env.PATH = originalPath;
      }

      const status = await supervisor.status();
      assert.match(status, /\binstalled=yes\b/);
    },
  );
});
