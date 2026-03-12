import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runLocalReview } from "../src/core/local-review";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "../src/types";

function makeConfig(artifactDir: string): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
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
    localReviewRoles: ["reviewer"],
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
  number: 17,
  title: "P6: Add local-review confidence-threshold parity",
  body: "",
  url: "https://example.test/issues/17",
};

const PR: GitHubPullRequest = {
  number: 42,
  url: "https://example.test/pull/42",
  state: "OPEN",
  isDraft: true,
  headRefName: "codex/issue-17",
  headRefOid: "abc123def4567890abc123def4567890abc123de",
  baseRefName: "main",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
};

test("runLocalReview filters actionable findings by confidence threshold in artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-local-review-threshold-"));
  const priorTask = (globalThis as Record<string, unknown>).task;
  (globalThis as Record<string, unknown>).task = async () => ({
    sessionId: "session-1",
    exitCode: 0,
    output: [
      "Review summary: Found 2 findings, only 1 should be actionable.",
      "Findings count: 2",
      "Max severity: high",
      "Recommendation: changes_requested",
      "REVIEW_FINDINGS_JSON_START",
      JSON.stringify({
        findings: [
          {
            title: "High confidence defect",
            body: "This can break in production.",
            severity: "high",
            confidence: 0.95,
            file: "src/core/supervisor.ts",
            start: 10,
            end: 10,
          },
          {
            title: "Low confidence concern",
            body: "This is speculative.",
            severity: "medium",
            confidence: 0.25,
            file: "src/core/supervisor.ts",
            start: 12,
            end: 12,
          },
        ],
        rootCauseSummaries: [
          {
            summary: "Head comparison still routes severe review blockers through draft iteration.",
            severity: "high",
            file: "src/core/supervisor.ts",
            start: 10,
            end: 12,
          },
        ],
        verifiedFindings: [
          {
            title: "High confidence defect",
            body: "This can break in production.",
            severity: "high",
            confidence: 0.95,
            file: "src/core/supervisor.ts",
            start: 10,
            end: 10,
          },
        ],
      }),
      "REVIEW_FINDINGS_JSON_END",
    ].join("\n"),
  });

  try {
    const config = makeConfig(tempDir) as SupervisorConfig & { localReviewConfidenceThreshold: number };

    const result = await runLocalReview({
      config,
      issue: ISSUE,
      branch: "codex/issue-17",
      workspacePath: "/tmp/workspace",
      defaultBranch: "main",
      pr: PR,
      alwaysReadFiles: [],
      onDemandFiles: [],
    });

    assert.equal(result.findingsCount, 1);
    assert.equal(result.rootCauseCount, 1);
    assert.equal(result.verifiedFindingsCount, 1);
    assert.equal(result.verifiedMaxSeverity, "high");
    assert.equal(result.recommendation, "changes_requested");

    const summary = await fs.readFile(result.summaryPath, "utf8");
    assert.match(summary, /Confidence threshold:\s+0\.70/);
    assert.match(summary, /Actionable findings:\s+1/);
    assert.match(summary, /Root causes:\s+1/);
    assert.match(summary, /Verified findings:\s+1/);

    const findings = JSON.parse(await fs.readFile(result.findingsPath, "utf8")) as Record<string, unknown>;
    assert.equal(findings.confidenceThreshold, 0.7);
    assert.equal(findings.actionableFindingsCount, 1);
    assert.equal(findings.rootCauseCount, 1);
    assert.equal(findings.verifiedFindingsCount, 1);
    assert.equal(findings.verifiedMaxSeverity, "high");
  } finally {
    if (typeof priorTask === "undefined") {
      delete (globalThis as Record<string, unknown>).task;
    } else {
      (globalThis as Record<string, unknown>).task = priorTask;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
