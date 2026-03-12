import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentExecutionPolicy } from "../src/agent/agent";
import { SupervisorConfig } from "../src/types";

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

test("quick category model clamps xhigh reasoning to high", () => {
  const config = makeConfig();
  const policy = resolveAgentExecutionPolicy(config, "implementing", null);

  assert.equal(policy.category, "quick");
  assert.equal(policy.model, "opencode/gpt-5-nano");
  assert.equal(policy.reasoningEffort, "high");
});

test("quick category model clamps none reasoning to low", () => {
  const config = makeConfig({
    reasoningEffortByState: {
      implementing: "none",
    },
  });
  const policy = resolveAgentExecutionPolicy(config, "implementing", null);

  assert.equal(policy.category, "quick");
  assert.equal(policy.model, "opencode/gpt-5-nano");
  assert.equal(policy.reasoningEffort, "low");
});

test("ultrabrain thinking model clamps none reasoning to low", () => {
  const config = makeConfig();
  const policy = resolveAgentExecutionPolicy(config, "resolving_conflict", null);

  assert.equal(policy.category, "ultrabrain");
  assert.equal(policy.model, "kimi-for-coding/kimi-k2-thinking");
  assert.equal(policy.reasoningEffort, "low");
});

test("repeated-failure escalation applies before model clamp", () => {
  const config = makeConfig({
    reasoningEffortByState: {
      implementing: "high",
    },
  });
  const policy = resolveAgentExecutionPolicy(config, "implementing", {
    repeated_failure_signature_count: 1,
    blocked_verification_retry_count: 0,
    timeout_retry_count: 0,
  });

  // high + escalation => xhigh, then nano model clamps xhigh => high
  assert.equal(policy.reasoningEffort, "high");
});
