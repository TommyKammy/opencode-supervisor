import assert from "node:assert/strict";
import test from "node:test";
import { reconcileStaleFailedIssueStates, shouldAutoRetryHandoffMissing } from "../src/core/supervisor";
import { GitHubIssue, IssueRunRecord, SupervisorConfig, SupervisorStateFile } from "../src/types";

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
    issue_number: 23,
    state: "blocked",
    branch: "opencode/issue-23",
    pr_number: null,
    workspace: "/tmp/workspaces/issue-23",
    journal_path: null,
    review_wait_started_at: "2026-03-12T00:00:00.000Z",
    review_wait_head_sha: "deadbeef",
    agent_session_id: "session-1",
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
    repeated_failure_signature_count: 1,
    last_head_sha: null,
    last_agent_summary: null,
    last_error: "Agent completed without updating the issue journal.",
    last_failure_kind: null,
    last_failure_context: {
      category: "blocked",
      summary: "Agent completed without updating the issue journal for issue #23.",
      signature: "handoff-missing",
      command: null,
      details: ["Update the Agent Working Notes section before ending the turn."],
      url: null,
      updated_at: "2026-03-12T00:00:00.000Z",
    },
    last_blocker_signature: "handoff-missing",
    last_failure_signature: "handoff-missing",
    blocked_reason: "handoff_missing",
    processed_review_thread_ids: [],
    updated_at: "2026-03-12T00:00:00.000Z",
    ...overrides,
  };
}

function makeIssue(state: string): GitHubIssue {
  return {
    number: 23,
    title: "Issue 23",
    body: "",
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    url: "https://example.test/issues/23",
    state,
    labels: [],
  };
}

class FakeStateStore {
  public saveCalls = 0;

  touch(record: IssueRunRecord, patch: Partial<IssueRunRecord>): IssueRunRecord {
    return {
      ...record,
      ...patch,
      updated_at: "2026-03-12T00:00:01.000Z",
    };
  }

  async save(_state: SupervisorStateFile): Promise<void> {
    this.saveCalls += 1;
  }
}

const fakeGithub = {
  async getPullRequestIfExists(): Promise<null> {
    throw new Error("unexpected getPullRequestIfExists call");
  },
  async getChecks(): Promise<[]> {
    throw new Error("unexpected getChecks call");
  },
  async getUnresolvedReviewThreads(): Promise<[]> {
    throw new Error("unexpected getUnresolvedReviewThreads call");
  },
};

test("shouldAutoRetryHandoffMissing allows bounded no-PR retries", () => {
  assert.equal(shouldAutoRetryHandoffMissing(makeRecord(), makeConfig()), true);
  assert.equal(
    shouldAutoRetryHandoffMissing(makeRecord({ pr_number: 99 }), makeConfig()),
    false,
  );
  assert.equal(
    shouldAutoRetryHandoffMissing(
      makeRecord({ repeated_failure_signature_count: 3 }),
      makeConfig({ sameFailureSignatureRepeatLimit: 3 }),
    ),
    false,
  );
});

test("reconcileStaleFailedIssueStates requeues recoverable handoff_missing blockers for open issues", async () => {
  const record = makeRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: 23,
    issues: { "23": record },
  };
  const stateStore = new FakeStateStore();

  await reconcileStaleFailedIssueStates(
    fakeGithub as never,
    stateStore as never,
    state,
    makeConfig(),
    [makeIssue("OPEN")],
  );

  const updated = state.issues["23"];
  assert.equal(updated.state, "queued");
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_error, null);
  assert.equal(updated.last_failure_signature, "handoff-missing");
  assert.equal(updated.repeated_failure_signature_count, 1);
  assert.equal(updated.agent_session_id, null);
  assert.equal(updated.review_wait_started_at, null);
  assert.equal(updated.review_wait_head_sha, null);
  assert.equal(stateStore.saveCalls, 1);
});

test("reconcileStaleFailedIssueStates leaves handoff_missing blockers unchanged when the issue is closed", async () => {
  const record = makeRecord();
  const state: SupervisorStateFile = {
    activeIssueNumber: 23,
    issues: { "23": record },
  };
  const stateStore = new FakeStateStore();

  await reconcileStaleFailedIssueStates(
    fakeGithub as never,
    stateStore as never,
    state,
    makeConfig(),
    [makeIssue("CLOSED")],
  );

  assert.equal(state.issues["23"].state, "blocked");
  assert.equal(state.issues["23"].blocked_reason, "handoff_missing");
  assert.equal(stateStore.saveCalls, 0);
});
