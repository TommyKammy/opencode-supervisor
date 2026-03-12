import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runLocalReview } from "../src/core/local-review";
import { AgentTurnResult, GitHubIssue, GitHubPullRequest, SupervisorConfig } from "../src/types";

function makeConfig(repoPath: string, artifactDir: string, tempDir: string): SupervisorConfig {
  return {
    repoPath,
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: path.join(tempDir, "workspaces"),
    stateBackend: "json",
    stateFile: path.join(tempDir, "state.json"),
    agentCategoryByState: {},
    reasoningEffortByState: {},
    reasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdPlanningFiles: ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"],
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewRoles: [],
    localReviewArtifactDir: artifactDir,
    localReviewConfidenceThreshold: 0.7,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".opencode-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "opencode/issue-",
    pollIntervalSeconds: 120,
    copilotReviewWaitMinutes: 10,
    agentExecTimeoutMinutes: 30,
    maxAgentAttemptsPerIssue: 30,
    timeoutRetryLimit: 2,
    blockedVerificationRetryLimit: 3,
    sameBlockerRepeatLimit: 2,
    sameFailureSignatureRepeatLimit: 3,
    maxDoneWorkspaces: 24,
    cleanupDoneWorkspacesAfterHours: 24,
    mergeMethod: "squash",
    draftPrAfterAttempt: 1,
  };
}

const ISSUE: GitHubIssue = {
  number: 21,
  title: "P6: Add local-review role auto-detection parity",
  body: "",
  url: "https://example.test/issues/21",
};

const PR: GitHubPullRequest = {
  number: 44,
  url: "https://example.test/pull/44",
  state: "OPEN",
  isDraft: true,
  headRefName: "opencode/issue-21",
  headRefOid: "abc123def4567890abc123def4567890abc123de",
  baseRefName: "main",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
};

test("runLocalReview auto-detects specialist roles from the reviewed workspace when localReviewRoles is empty", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-local-review-roles-"));
  const configRepoPath = path.join(tempDir, "config-repo");
  const workspacePath = path.join(tempDir, "workspace");
  const artifactDir = path.join(tempDir, "artifacts");
  const capturedPrompts: string[] = [];

  await fs.mkdir(configRepoPath, { recursive: true });
  await fs.mkdir(path.join(workspacePath, ".github", "workflows"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "package.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(workspacePath, ".github", "workflows", "ci.yml"), "name: CI\n", "utf8");
  await fs.writeFile(path.join(workspacePath, "src", "ci-workflow.test.ts"), "import test from 'node:test';\n", "utf8");

  const agentTurnRunner = async (
    _config: SupervisorConfig,
    _workspacePath: string,
    prompt: string,
  ): Promise<AgentTurnResult> => {
    capturedPrompts.push(prompt);
    const output = [
      "Review summary: No actionable findings.",
      "Findings count: 0",
      "Max severity: none",
      "Recommendation: ready",
      "REVIEW_FINDINGS_JSON_START",
      JSON.stringify({ findings: [] }),
      "REVIEW_FINDINGS_JSON_END",
    ].join("\n");
    return {
      sessionId: "session-roles",
      exitCode: 0,
      lastMessage: output,
      stderr: "",
      stdout: output,
    };
  };

  try {
    await runLocalReview({
      config: makeConfig(configRepoPath, artifactDir, tempDir),
      issue: ISSUE,
      branch: "opencode/issue-21",
      workspacePath,
      defaultBranch: "main",
      pr: PR,
      alwaysReadFiles: [],
      onDemandFiles: [],
      agentTurnRunner,
    });

    assert.equal(capturedPrompts.length, 1);
    const prompt = capturedPrompts[0];
    const expectedRoles = [
      "reviewer",
      "explorer",
      "github_actions_semantics_reviewer",
      "workflow_test_reviewer",
      "portability_reviewer",
    ];
    for (const role of expectedRoles) {
      assert.match(prompt, new RegExp(`\\b${role}\\b`));
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
