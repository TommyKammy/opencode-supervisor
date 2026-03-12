import assert from "node:assert/strict";
import test from "node:test";
import { extractStateHint } from "../src/agent/agent";
import { inferStateFromPullRequest } from "../src/core/supervisor";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../src/types";

function createConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    repoPath: "/tmp/repo",
    repoSlug: "owner/repo",
    defaultBranch: "main",
    workspaceRoot: "/tmp/workspaces",
    stateBackend: "json",
    stateFile: "/tmp/state.json",
    stateBootstrapFile: undefined,
    agentCategoryByState: {},
    reasoningEffortByState: {},
    reasoningEscalateOnRepeatedFailure: true,
    sharedMemoryFiles: [],
    gsdEnabled: false,
    gsdAutoInstall: false,
    gsdInstallScope: "global",
    gsdCodexConfigDir: undefined,
    gsdPlanningFiles: ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"],
    localReviewEnabled: true,
    localReviewPolicy: "block_ready",
    localReviewRoles: ["reviewer"],
    localReviewArtifactDir: "/tmp/reviews",
    localReviewConfidenceThreshold: 0.7,
    reviewBotLogins: ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge: true,
    issueJournalRelativePath: ".opencode-supervisor/issue-journal.md",
    issueJournalMaxChars: 6000,
    issueLabel: undefined,
    issueSearch: undefined,
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

function createRecord(overrides: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 27,
    state: "draft_pr",
    branch: "opencode/issue-27",
    pr_number: 44,
    workspace: "/tmp/workspaces/issue-27",
    journal_path: "/tmp/workspaces/issue-27/.opencode-supervisor/issue-journal.md",
    review_wait_started_at: null,
    review_wait_head_sha: null,
    agent_session_id: null,
    local_review_head_sha: "head123",
    local_review_summary_path: "/tmp/reviews/head123.md",
    local_review_run_at: "2026-03-12T00:00:00Z",
    local_review_max_severity: "high",
    local_review_findings_count: 3,
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
    number: 44,
    title: "Test PR",
    url: "https://example.test/pr/44",
    state: "OPEN",
    createdAt: "2026-03-12T00:00:00Z",
    updatedAt: "2026-03-12T00:00:00Z",
    isDraft: true,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "opencode/issue-27",
    headRefOid: "head123",
    mergedAt: null,
    ...overrides,
  };
}

test("extractStateHint accepts local_review_fix", () => {
  assert.equal(extractStateHint("State hint: local_review_fix"), "local_review_fix");
});

test("inferStateFromPullRequest routes verified severe local review findings into local_review_fix", () => {
  const config = createConfig();
  const record = createRecord({
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    repeated_local_review_signature_count: 1,
  });
  const pr = createPullRequest();

  assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "local_review_fix");
});

test("inferStateFromPullRequest blocks stalled repeated local_review_fix loops on identical blockers", () => {
  const config = createConfig({ sameFailureSignatureRepeatLimit: 3 });
  const record = createRecord({
    state: "local_review_fix",
    local_review_verified_max_severity: "high",
    local_review_verified_findings_count: 1,
    repeated_local_review_signature_count: 3,
  });
  const pr = createPullRequest();

  assert.equal(inferStateFromPullRequest(config, record, pr, [], []), "blocked");
});
