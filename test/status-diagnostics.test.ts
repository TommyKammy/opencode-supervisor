import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatDetailedStatus, Supervisor } from "../src/core/supervisor";
import { GitHubPullRequest, IssueRunRecord, SupervisorConfig } from "../src/types";

const BASE_CONFIG = {
  repoPath: "/tmp/repo",
  repoSlug: "owner/repo",
  defaultBranch: "main",
  workspaceRoot: "/tmp/workspaces",
  stateFile: "/tmp/state.json",
  branchPrefix: "opencode/issue-",
};

async function withTempSupervisor(
  payload: Record<string, unknown>,
  run: (supervisor: Supervisor, configPath: string) => Promise<void> | void,
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-status-diagnostics-"));
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

    await run(Supervisor.fromConfig(configPath), configPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createRecord(config: SupervisorConfig, patch: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return {
    issue_number: 24,
    state: "local_review",
    branch: "opencode/issue-24",
    pr_number: 42,
    workspace: path.join(config.workspaceRoot, "issue-24"),
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
    ...patch,
  };
}

function createPullRequest(headRefOid: string): GitHubPullRequest {
  return {
    number: 42,
    title: "Diagnostics parity",
    url: "https://example.invalid/pr/42",
    state: "OPEN",
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:05:00.000Z",
    isDraft: false,
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    headRefName: "opencode/issue-24",
    headRefOid,
    mergedAt: null,
  };
}

test("status output includes readiness summary lines when idle", async () => {
  await withTempSupervisor({}, async (supervisor) => {
    await (supervisor as any).stateStore.save({
      activeIssueNumber: null,
      issues: {
        "3": createRecord(supervisor.config, {
          issue_number: 3,
          state: "done",
          pr_number: null,
          branch: "opencode/issue-3",
          updated_at: "2026-03-12T00:10:00.000Z",
        }),
      },
    });

    const github = (supervisor as any).github as {
      listCandidateIssues: () => Promise<Array<{ number: number; title: string; body: string; createdAt: string; updatedAt: string; url: string; state: string }>>;
    };
    github.listCandidateIssues = async () => [
      {
        number: 1,
        title: "Runnable issue",
        body: "",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
        url: "https://example.invalid/issues/1",
        state: "OPEN",
      },
      {
        number: 2,
        title: "Blocked by dependency",
        body: "Depends on: #1",
        createdAt: "2026-03-12T00:01:00.000Z",
        updatedAt: "2026-03-12T00:01:00.000Z",
        url: "https://example.invalid/issues/2",
        state: "OPEN",
      },
      {
        number: 3,
        title: "Already completed locally",
        body: "",
        createdAt: "2026-03-12T00:02:00.000Z",
        updatedAt: "2026-03-12T00:02:00.000Z",
        url: "https://example.invalid/issues/3",
        state: "OPEN",
      },
    ];

    const output = await supervisor.status();
    assert.match(output, /^No active issue\.$/m);
    assert.match(output, /^runnable_issues=#1$/m);
    assert.match(output, /^blocked_issues=#2 blocked_by=depends on #1; #3 blocked_by=local_state:done$/m);
  });
});

test("status output falls back to an informative readiness warning", async () => {
  await withTempSupervisor({}, async (supervisor) => {
    const github = (supervisor as any).github as {
      listCandidateIssues: () => Promise<never>;
    };
    github.listCandidateIssues = async () => {
      throw new Error("");
    };

    const output = await supervisor.status();
    assert.match(output, /^readiness_warning=unknown$/m);
  });
});

test("formatDetailedStatus shows stale local-review head details for merge gating", async () => {
  await withTempSupervisor({ localReviewPolicy: "block_merge" }, async (supervisor) => {
    const output = formatDetailedStatus({
      config: supervisor.config,
      activeRecord: createRecord(supervisor.config, {
        local_review_head_sha: "reviewed-sha",
        local_review_run_at: "2026-03-12T00:03:00.000Z",
        local_review_findings_count: 1,
        local_review_root_cause_count: 1,
        local_review_max_severity: "medium",
        local_review_verified_max_severity: "medium",
        local_review_verified_findings_count: 1,
        local_review_recommendation: "changes_requested",
        last_local_review_signature: "local-review:medium:medium:1:1:clean",
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest("current-pr-sha"),
      checks: [],
      reviewThreads: [],
    });

    assert.match(output, /local_review gating=no policy=block_merge /);
    assert.match(output, /head=stale reviewed_head_sha=reviewed-sha pr_head_sha=current-pr-sha/);
    assert.match(output, /stalled=no/);
  });
});

test("formatDetailedStatus shows current gating review and repeat-loop state", async () => {
  await withTempSupervisor({ localReviewPolicy: "block_merge" }, async (supervisor) => {
    const repeatedCount = supervisor.config.sameFailureSignatureRepeatLimit;
    const output = formatDetailedStatus({
      config: supervisor.config,
      activeRecord: createRecord(supervisor.config, {
        local_review_head_sha: "current-pr-sha",
        local_review_run_at: "2026-03-12T00:04:00.000Z",
        local_review_findings_count: 2,
        local_review_root_cause_count: 1,
        local_review_max_severity: "high",
        local_review_verified_max_severity: "high",
        local_review_verified_findings_count: 1,
        local_review_recommendation: "changes_requested",
        last_local_review_signature: "local-review:high:high:1:1:clean",
        repeated_local_review_signature_count: repeatedCount,
      }),
      latestRecord: null,
      trackedIssueCount: 1,
      pr: createPullRequest("current-pr-sha"),
      checks: [],
      reviewThreads: [],
    });

    assert.match(output, /local_review gating=yes policy=block_merge /);
    assert.match(output, /head=current reviewed_head_sha=current-pr-sha pr_head_sha=current-pr-sha/);
    assert.match(output, new RegExp(`repeated=${repeatedCount}`));
    assert.match(output, /stalled=yes/);
  });
});
