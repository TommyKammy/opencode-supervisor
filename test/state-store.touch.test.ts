import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../src/persistence/state-store";
import { IssueRunRecord } from "../src/types";

function makeRecord(): IssueRunRecord {
  return {
    issue_number: 42,
    state: "draft_pr",
    branch: "opencode/issue-42",
    pr_number: 7,
    workspace: "/tmp/workspace-42",
    journal_path: "/tmp/workspace-42/.opencode-supervisor/issue-journal.md",
    review_wait_started_at: "2026-03-10T00:00:00.000Z",
    review_wait_head_sha: "abc1234",
    agent_session_id: "session-123",
    local_review_head_sha: "deadbeef",
    local_review_summary_path: "/tmp/reviews/summary.md",
    local_review_run_at: "2026-03-10T00:01:00.000Z",
    local_review_max_severity: "medium",
    local_review_findings_count: 2,
    attempt_count: 3,
    timeout_retry_count: 1,
    blocked_verification_retry_count: 1,
    repeated_blocker_count: 1,
    repeated_failure_signature_count: 1,
    last_head_sha: "feedface",
    last_agent_summary: "Summary text",
    last_error: "Some error",
    last_failure_kind: "command_error",
    last_failure_context: {
      category: "agent",
      summary: "failure context",
      signature: "sig-1",
      command: "npm test",
      details: ["detail"],
      url: null,
      updated_at: "2026-03-10T00:02:00.000Z",
    },
    last_blocker_signature: "blocker-1",
    last_failure_signature: "failure-1",
    blocked_reason: "unknown",
    processed_review_thread_ids: ["thread-1"],
    updated_at: "2026-03-10T00:03:00.000Z",
  };
}

test("touch preserves existing nullable fields when patch omits keys", () => {
  const store = new StateStore("/tmp/opencode-supervisor-tests/state.json", { backend: "json" });
  const record = makeRecord();

  const updated = store.touch(record, { state: "stabilizing" });

  assert.equal(updated.state, "stabilizing");
  assert.equal(updated.local_review_summary_path, record.local_review_summary_path);
  assert.equal(updated.blocked_reason, record.blocked_reason);
  assert.equal(updated.last_failure_context?.summary, "failure context");
});

test("touch clears nullable fields when patch explicitly sets null", () => {
  const store = new StateStore("/tmp/opencode-supervisor-tests/state.json", { backend: "json" });
  const record = makeRecord();

  const updated = store.touch(record, {
    local_review_summary_path: null,
    blocked_reason: null,
    last_failure_context: null,
    last_failure_signature: null,
  });

  assert.equal(updated.local_review_summary_path, null);
  assert.equal(updated.blocked_reason, null);
  assert.equal(updated.last_failure_context, null);
  assert.equal(updated.last_failure_signature, null);
});
