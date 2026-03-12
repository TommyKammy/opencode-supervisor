import assert from "node:assert/strict";
import test from "node:test";
import { buildChecksFailureContext, inferStateFromPullRequest, summarizeChecks } from "../src/core/supervisor";
import { GitHubPullRequest, IssueRunRecord, PullRequestCheck, ReviewThread, SupervisorConfig } from "../src/types";

function makeConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
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
    gsdPlanningFiles: [],
    localReviewEnabled: false,
    localReviewPolicy: "block_ready",
    localReviewRoles: ["reviewer"],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    reviewBotLogins: [],
    humanReviewBlocksMerge: false,
    issueJournalRelativePath: ".opencode-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    skipTitlePrefixes: [],
    branchPrefix: "opencode/issue-",
    pollIntervalSeconds: 120,
    copilotReviewWaitMinutes: 0,
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

function makeRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 25,
    state: "draft_pr",
    branch: "opencode/issue-25",
    pr_number: 25,
    workspace: "/tmp/workspaces/issue-25",
    journal_path: null,
    review_wait_started_at: null,
    review_wait_head_sha: null,
    agent_session_id: null,
    local_review_head_sha: null,
    local_review_summary_path: null,
    local_review_run_at: null,
    local_review_max_severity: null,
    local_review_findings_count: 0,
    local_review_root_cause_count: 0,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: null,
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    attempt_count: 1,
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
    updated_at: "2026-03-12T00:00:00.000Z",
    ...overrides,
  };
}

function makePullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 25,
    title: "Issue 25",
    url: "https://example.test/pr/25",
    state: "OPEN",
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "opencode/issue-25",
    headRefOid: "deadbeef",
    mergedAt: null,
    ...overrides,
  };
}

function makeCheck(overrides: Partial<PullRequestCheck> = {}): PullRequestCheck {
  return {
    name: "ci",
    state: "SUCCESS",
    bucket: "pass",
    ...overrides,
  };
}

const noReviewThreads: ReviewThread[] = [];

test("cancelled checks do not count as failing or emit failure context", () => {
  const checks = [makeCheck({ name: "build", state: "CANCELLED", bucket: "cancel" })];

  assert.deepEqual(summarizeChecks(checks), {
    allPassing: false,
    hasPending: false,
    hasFailing: false,
  });
  assert.equal(buildChecksFailureContext(makePullRequest(), checks), null);
});

test("failing checks still count as failing and emit failure context", () => {
  const checks = [makeCheck({ name: "build", state: "FAILURE", bucket: "fail" })];
  const context = buildChecksFailureContext(makePullRequest(), checks);

  assert.deepEqual(summarizeChecks(checks), {
    allPassing: false,
    hasPending: false,
    hasFailing: true,
  });
  assert.equal(context?.summary, "PR #25 has failing checks.");
  assert.equal(context?.signature, "build:fail");
  assert.deepEqual(context?.details, ["build (fail/FAILURE)"]);
});

test("mixed cancelled and failing checks stay failing but only report true failures in context", () => {
  const checks = [
    makeCheck({ name: "build", state: "CANCELLED", bucket: "cancel" }),
    makeCheck({ name: "lint", state: "FAILURE", bucket: "fail" }),
  ];
  const context = buildChecksFailureContext(makePullRequest(), checks);

  assert.equal(summarizeChecks(checks).hasFailing, true);
  assert.equal(context?.signature, "lint:fail");
  assert.deepEqual(context?.details, ["lint (fail/FAILURE)"]);
});

test("cancelled-only checks keep PR state out of repairing_ci", () => {
  const state = inferStateFromPullRequest(
    makeConfig(),
    makeRecord(),
    makePullRequest(),
    [makeCheck({ name: "build", state: "CANCELLED", bucket: "cancel" })],
    noReviewThreads,
  );

  assert.equal(state, "pr_open");
});

test("mixed cancelled and failing checks still infer repairing_ci", () => {
  const state = inferStateFromPullRequest(
    makeConfig(),
    makeRecord(),
    makePullRequest(),
    [
      makeCheck({ name: "build", state: "CANCELLED", bucket: "cancel" }),
      makeCheck({ name: "lint", state: "FAILURE", bucket: "fail" }),
    ],
    noReviewThreads,
  );

  assert.equal(state, "repairing_ci");
});
