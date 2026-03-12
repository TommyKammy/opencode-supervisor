import assert from "node:assert/strict";
import test from "node:test";
import { localReviewBlocksReady, inferStateFromPullRequest } from "../src/core/supervisor";
import { shouldRunLocalReview } from "../src/core/local-review";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../src/types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
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
    localReviewEnabled: true,
    localReviewRoles: ["reviewer"],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    localReviewPolicy: "block_ready",
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
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

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 44,
    state: "pr_open",
    branch: "opencode/issue-44",
    pr_number: 12,
    workspace: "/tmp/workspaces/issue-44",
    journal_path: "/tmp/workspaces/issue-44/.opencode-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    agent_session_id: null,
    local_review_head_sha: "head123",
    local_review_summary_path: "/tmp/reviews/head123.md",
    local_review_run_at: "2026-03-12T00:00:00Z",
    local_review_max_severity: "medium",
    local_review_findings_count: 1,
    local_review_root_cause_count: 1,
    local_review_verified_max_severity: null,
    local_review_verified_findings_count: 0,
    local_review_recommendation: "changes_requested",
    local_review_degraded: false,
    last_local_review_signature: null,
    repeated_local_review_signature_count: 0,
    attempt_count: 1,
    timeout_retry_count: 0,
    blocked_verification_retry_count: 0,
    repeated_blocker_count: 0,
    repeated_failure_signature_count: 0,
    last_head_sha: "head123",
    last_agent_summary: null,
    last_error: null,
    last_failure_kind: null,
    last_failure_context: null,
    last_blocker_signature: null,
    last_failure_signature: null,
    blocked_reason: null,
    processed_review_thread_ids: [],
    updated_at: "2026-03-12T00:00:00Z",
    ...overrides,
  };
}

function createPullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 12,
    title: "Test PR",
    url: "https://example.test/pr/12",
    state: "OPEN",
    createdAt: "2026-03-12T00:00:00Z",
    updatedAt: "2026-03-12T00:00:00Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "opencode/issue-44",
    headRefOid: "head456",
    mergedAt: null,
    ...overrides,
  };
}

test("localReviewBlocksReady blocks when recommendation is not ready on current head", () => {
  const blocked = localReviewBlocksReady(
    createConfig(),
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "changes_requested",
    },
    {
      headRefOid: "abc123",
      isDraft: true,
    },
  );

  assert.equal(blocked, true);
});

test("localReviewBlocksReady does not block when recommendation is ready with zero findings", () => {
  const blocked = localReviewBlocksReady(
    createConfig(),
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "ready",
    },
    {
      headRefOid: "abc123",
      isDraft: true,
    },
  );

  assert.equal(blocked, false);
});

test("localReviewBlocksReady does not block on verified severity alone when current findings are zero", () => {
  const blocked = localReviewBlocksReady(
    createConfig(),
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "ready",
      local_review_verified_max_severity: "high",
    },
    {
      headRefOid: "abc123",
      isDraft: true,
    },
  );

  assert.equal(blocked, false);
});

test("shouldRunLocalReview reruns for ready PR head updates only in block_merge mode", () => {
  const pr = createPullRequest({ isDraft: false, headRefOid: "newhead" });
  const record = { local_review_head_sha: "oldhead" };

  assert.equal(shouldRunLocalReview(createConfig({ localReviewPolicy: "block_merge" }), record, pr), true);
  assert.equal(shouldRunLocalReview(createConfig({ localReviewPolicy: "block_ready" }), record, pr), false);
  assert.equal(shouldRunLocalReview(createConfig({ localReviewPolicy: "advisory" }), record, pr), false);
});

test("inferStateFromPullRequest blocks merge for current-head findings only in block_merge mode", () => {
  const record = createRecord({
    local_review_head_sha: "head456",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
  });
  const pr = createPullRequest({ isDraft: false, headRefOid: "head456" });

  assert.equal(inferStateFromPullRequest(createConfig({ localReviewPolicy: "block_merge" }), record, pr, [], []), "pr_open");
  assert.equal(inferStateFromPullRequest(createConfig({ localReviewPolicy: "block_ready" }), record, pr, [], []), "ready_to_merge");
  assert.equal(inferStateFromPullRequest(createConfig({ localReviewPolicy: "advisory" }), record, pr, [], []), "ready_to_merge");
});

test("inferStateFromPullRequest does not treat stale ready-PR review data as freshly gated", () => {
  const record = createRecord({
    local_review_head_sha: "oldhead",
    local_review_findings_count: 1,
    local_review_recommendation: "changes_requested",
  });
  const pr = createPullRequest({ isDraft: false, headRefOid: "newhead" });

  assert.equal(inferStateFromPullRequest(createConfig({ localReviewPolicy: "block_merge" }), record, pr, [], []), "ready_to_merge");
});

test("disabled local review suppresses stale local-review-driven gating and retry states", () => {
  const config = createConfig({ localReviewEnabled: false, localReviewPolicy: "block_merge" });
  const record = createRecord({
    local_review_head_sha: "head456",
    local_review_findings_count: 2,
    local_review_recommendation: "changes_requested",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    repeated_local_review_signature_count: config.sameFailureSignatureRepeatLimit,
  });
  const readyPr = createPullRequest({ isDraft: false, headRefOid: "head456" });
  const draftPr = createPullRequest({ isDraft: true, headRefOid: "head456" });

  assert.equal(localReviewBlocksReady(config, record, draftPr), false);
  assert.equal(inferStateFromPullRequest(config, record, readyPr, [], []), "ready_to_merge");
  assert.equal(inferStateFromPullRequest(config, record, draftPr, [], []), "draft_pr");
});
