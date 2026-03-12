import assert from "node:assert/strict";
import test from "node:test";
import { selectDoneWorkspaceCleanupRecords } from "../src/core/supervisor";
import { IssueRunRecord, SupervisorConfig, SupervisorStateFile } from "../src/types";

function makeConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    agentCategoryByState: {
      implementing: "quick",
      resolving_conflict: "ultrabrain",
    },
    reasoningEffortByState: {
      implementing: "xhigh",
      resolving_conflict: "none",
    },
    reasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    localReviewEnabled: false,
    localReviewPolicy: "block_ready",
    localReviewRoles: ["reviewer"],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    reviewBotLogins: [],
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
    ...overrides,
  };
}

function makeDoneRecord(issueNumber: number, updatedAt: string): IssueRunRecord {
  return {
    issue_number: issueNumber,
    state: "done",
    branch: `opencode/issue-${issueNumber}`,
    pr_number: null,
    workspace: `/tmp/workspaces/issue-${issueNumber}`,
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    agent_session_id: null,
    local_review_head_sha: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    attempt_count: 0,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: null,
    last_agent_summary: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    updated_at: updatedAt,
  };
}

function makeState(records: IssueRunRecord[]): SupervisorStateFile {
  return {
    activeIssueNumber: null,
    issues: Object.fromEntries(records.map((record) => [String(record.issue_number), record])),
  };
}

test("selectDoneWorkspaceCleanupRecords prunes oldest overflow done workspaces first", () => {
  const state = makeState([
    makeDoneRecord(1, "2026-03-08T00:00:00.000Z"),
    makeDoneRecord(2, "2026-03-09T00:00:00.000Z"),
    makeDoneRecord(3, "2026-03-10T00:00:00.000Z"),
  ]);
  const config = makeConfig({
    maxDoneWorkspaces: 1,
    cleanupDoneWorkspacesAfterHours: -1,
  });

  const records = selectDoneWorkspaceCleanupRecords(config, state, {
    workspaceExists: () => true,
  });

  assert.deepEqual(
    records.map((record) => record.issue_number),
    [1, 2],
  );
});

test("selectDoneWorkspaceCleanupRecords enforces zero cap by cleaning all existing done workspaces", () => {
  const state = makeState([
    makeDoneRecord(1, "2026-03-08T00:00:00.000Z"),
    makeDoneRecord(2, "2026-03-09T00:00:00.000Z"),
    makeDoneRecord(3, "2026-03-10T00:00:00.000Z"),
  ]);
  const config = makeConfig({
    maxDoneWorkspaces: 0,
    cleanupDoneWorkspacesAfterHours: -1,
  });

  const records = selectDoneWorkspaceCleanupRecords(config, state, {
    workspaceExists: (workspacePath) => !workspacePath.endsWith("/issue-2"),
  });

  assert.deepEqual(
    records.map((record) => record.issue_number),
    [1, 3],
  );
});

test("selectDoneWorkspaceCleanupRecords disables count pruning when maxDoneWorkspaces is negative", () => {
  const state = makeState([
    makeDoneRecord(1, "2026-03-08T00:00:00.000Z"),
    makeDoneRecord(2, "2026-03-09T00:00:00.000Z"),
    makeDoneRecord(3, "2026-03-10T00:00:00.000Z"),
  ]);
  const config = makeConfig({
    maxDoneWorkspaces: -1,
    cleanupDoneWorkspacesAfterHours: 24,
  });

  const ageByUpdatedAt = new Map([
    ["2026-03-08T00:00:00.000Z", 96],
    ["2026-03-09T00:00:00.000Z", 4],
    ["2026-03-10T00:00:00.000Z", 80],
  ]);
  const records = selectDoneWorkspaceCleanupRecords(config, state, {
    workspaceExists: () => true,
    hoursSinceUpdatedAt: (updatedAt) => ageByUpdatedAt.get(updatedAt) ?? 0,
  });

  assert.deepEqual(
    records.map((record) => record.issue_number),
    [1, 3],
  );
});

test("selectDoneWorkspaceCleanupRecords skips cleanup when both retention rules are disabled", () => {
  const state = makeState([
    makeDoneRecord(1, "2026-03-08T00:00:00.000Z"),
    makeDoneRecord(2, "2026-03-09T00:00:00.000Z"),
  ]);
  const config = makeConfig({
    maxDoneWorkspaces: -1,
    cleanupDoneWorkspacesAfterHours: -1,
  });

  const records = selectDoneWorkspaceCleanupRecords(config, state, {
    workspaceExists: () => true,
  });

  assert.deepEqual(records, []);
});
