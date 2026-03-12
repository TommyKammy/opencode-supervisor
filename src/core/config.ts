import fs from "node:fs";
import path from "node:path";
import { AgentCategory, LocalReviewPolicy, ReasoningEffort, RunState, SupervisorConfig } from "../types";
import { isValidGitRefName, parseJson, resolveMaybeRelative } from "../utils";

const DEFAULT_CONFIG_FILE = "supervisor.config.json";
const DEFAULT_GSD_PLANNING_FILES = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"];

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid config field: ${label}`);
  }

  return value;
}

function assertPattern(value: string, label: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

function assertGitRefName(value: string, label: string): string {
  if (!isValidGitRefName(value)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

function assertBranchPrefix(value: string, label: string): string {
  if (!isValidGitRefName(`${value}1`)) {
    throw new Error(`Invalid config field: ${label}`);
  }

  return value;
}

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);
const VALID_AGENT_CATEGORIES = new Set<AgentCategory>([
  "quick",
  "deep",
  "ultrabrain",
  "visual-engineering",
  "unspecified-high",
  "unspecified-low",
  "writing",
  "artistry",
]);
const VALID_RUN_STATES = new Set<RunState>([
  "queued",
  "planning",
  "reproducing",
  "implementing",
  "local_review_fix",
  "stabilizing",
  "draft_pr",
  "local_review",
  "pr_open",
  "repairing_ci",
  "resolving_conflict",
  "waiting_ci",
  "addressing_review",
  "ready_to_merge",
  "merging",
  "done",
  "blocked",
  "failed",
]);
const VALID_LOCAL_REVIEW_POLICIES = new Set<LocalReviewPolicy>(["advisory", "block_ready", "block_merge"]);

function parseEnumPolicy<T extends string>(
  value: unknown,
  validValues: Set<T>,
): Partial<Record<RunState, T>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, raw]) => VALID_RUN_STATES.has(key as RunState) && typeof raw === "string" && validValues.has(raw as T))
    .map(([key, raw]) => [key as RunState, raw as T]);

  return Object.fromEntries(entries) as Partial<Record<RunState, T>>;
}

// Default agent category mapping from state to opencode category
const DEFAULT_AGENT_CATEGORY_BY_STATE: Record<RunState, AgentCategory> = {
  queued: "quick",
  planning: "deep",
  reproducing: "deep",
  implementing: "ultrabrain",
  local_review_fix: "deep",
  stabilizing: "unspecified-high",
  draft_pr: "quick",
  local_review: "deep",
  pr_open: "quick",
  repairing_ci: "quick",
  resolving_conflict: "unspecified-high",
  waiting_ci: "quick",
  addressing_review: "deep",
  ready_to_merge: "quick",
  merging: "quick",
  done: "quick",
  blocked: "quick",
  failed: "quick",
};

// Default reasoning effort by state
const DEFAULT_REASONING_BY_STATE: Record<RunState, ReasoningEffort> = {
  queued: "low",
  planning: "low",
  reproducing: "medium",
  implementing: "high",
  local_review_fix: "medium",
  stabilizing: "medium",
  draft_pr: "low",
  local_review: "low",
  pr_open: "low",
  repairing_ci: "medium",
  resolving_conflict: "high",
  waiting_ci: "low",
  addressing_review: "medium",
  ready_to_merge: "low",
  merging: "low",
  done: "low",
  blocked: "low",
  failed: "low",
};

export function resolveConfigPath(configPath?: string): string {
  return configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
}

export function loadConfig(configPath?: string): SupervisorConfig {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = parseJson<Record<string, unknown>>(fs.readFileSync(resolvedPath, "utf8"), resolvedPath);
  const configDir = path.dirname(resolvedPath);

  // Parse agent category mapping
  const agentCategoryByState = parseEnumPolicy<AgentCategory>(
    raw.agentCategoryByState,
    VALID_AGENT_CATEGORIES,
  );
  const reasoningEffortByState = parseEnumPolicy<ReasoningEffort>(
    raw.reasoningEffortByState,
    VALID_REASONING_EFFORTS,
  );

  const config: SupervisorConfig = {
    repoPath: resolveMaybeRelative(configDir, assertString(raw.repoPath, "repoPath")),
    repoSlug: assertPattern(assertString(raw.repoSlug, "repoSlug"), "repoSlug", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    defaultBranch: assertGitRefName(assertString(raw.defaultBranch, "defaultBranch"), "defaultBranch"),
    workspaceRoot: resolveMaybeRelative(configDir, assertString(raw.workspaceRoot, "workspaceRoot")),
    stateBackend:
      raw.stateBackend === "sqlite" || raw.stateBackend === "json"
        ? raw.stateBackend
        : "json",
    stateFile: resolveMaybeRelative(configDir, assertString(raw.stateFile, "stateFile")),
    stateBootstrapFile:
      typeof raw.stateBootstrapFile === "string" && raw.stateBootstrapFile.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.stateBootstrapFile)
        : undefined,
    // Merge default categories with any overrides from config
    agentCategoryByState: {
      ...DEFAULT_AGENT_CATEGORY_BY_STATE,
      ...agentCategoryByState,
    },
    reasoningEffortByState: {
      ...DEFAULT_REASONING_BY_STATE,
      ...reasoningEffortByState,
    },
    reasoningEscalateOnRepeatedFailure:
      typeof raw.reasoningEscalateOnRepeatedFailure === "boolean"
        ? raw.reasoningEscalateOnRepeatedFailure
        : true,
    sharedMemoryFiles: Array.isArray(raw.sharedMemoryFiles)
      ? raw.sharedMemoryFiles.filter((value): value is string => typeof value === "string")
      : [],
    gsdEnabled:
      typeof raw.gsdEnabled === "boolean"
        ? raw.gsdEnabled
        : false,
    gsdAutoInstall:
      typeof raw.gsdAutoInstall === "boolean"
        ? raw.gsdAutoInstall
        : false,
    gsdInstallScope:
      raw.gsdInstallScope === "local" || raw.gsdInstallScope === "global"
        ? raw.gsdInstallScope
        : "global",
    gsdCodexConfigDir:
      typeof raw.gsdCodexConfigDir === "string" && raw.gsdCodexConfigDir.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.gsdCodexConfigDir)
        : undefined,
    gsdPlanningFiles: Array.isArray(raw.gsdPlanningFiles)
      ? raw.gsdPlanningFiles.filter((value): value is string => typeof value === "string" && value.trim() !== "")
      : DEFAULT_GSD_PLANNING_FILES,
    localReviewEnabled:
      typeof raw.localReviewEnabled === "boolean"
        ? raw.localReviewEnabled
        : false,
    localReviewRoles: Array.isArray(raw.localReviewRoles)
      ? raw.localReviewRoles.filter((value): value is string => typeof value === "string" && value.trim() !== "")
      : ["reviewer", "explorer"],
    localReviewArtifactDir:
      typeof raw.localReviewArtifactDir === "string" && raw.localReviewArtifactDir.trim() !== ""
        ? resolveMaybeRelative(configDir, raw.localReviewArtifactDir)
        : path.join(path.dirname(resolveMaybeRelative(configDir, assertString(raw.stateFile, "stateFile"))), "reviews"),
    localReviewConfidenceThreshold:
      typeof raw.localReviewConfidenceThreshold === "number" &&
      Number.isFinite(raw.localReviewConfidenceThreshold) &&
      raw.localReviewConfidenceThreshold >= 0 &&
      raw.localReviewConfidenceThreshold <= 1
        ? raw.localReviewConfidenceThreshold
        : 0.7,
    localReviewPolicy:
      typeof raw.localReviewPolicy === "string" && VALID_LOCAL_REVIEW_POLICIES.has(raw.localReviewPolicy as LocalReviewPolicy)
        ? (raw.localReviewPolicy as LocalReviewPolicy)
        : "block_ready",
    reviewBotLogins: Array.isArray(raw.reviewBotLogins)
      ? raw.reviewBotLogins
          .filter((value): value is string => typeof value === "string" && value.trim() !== "")
          .map((value) => value.trim().toLowerCase())
      : ["copilot-pull-request-reviewer"],
    humanReviewBlocksMerge:
      typeof raw.humanReviewBlocksMerge === "boolean"
        ? raw.humanReviewBlocksMerge
        : true,
    issueJournalRelativePath:
      typeof raw.issueJournalRelativePath === "string" && raw.issueJournalRelativePath.trim() !== ""
        ? raw.issueJournalRelativePath
        : ".opencode-supervisor/issue-journal.md",
    issueJournalMaxChars:
      typeof raw.issueJournalMaxChars === "number" && raw.issueJournalMaxChars >= 2000
        ? raw.issueJournalMaxChars
        : 6000,
    issueLabel: typeof raw.issueLabel === "string" ? raw.issueLabel : undefined,
    issueSearch: typeof raw.issueSearch === "string" ? raw.issueSearch : undefined,
    skipTitlePrefixes: Array.isArray(raw.skipTitlePrefixes)
      ? raw.skipTitlePrefixes.filter((value): value is string => typeof value === "string")
      : [],
    branchPrefix: assertBranchPrefix(assertString(raw.branchPrefix, "branchPrefix"), "branchPrefix"),
    pollIntervalSeconds:
      typeof raw.pollIntervalSeconds === "number" && raw.pollIntervalSeconds > 0
        ? raw.pollIntervalSeconds
        : 120,
    copilotReviewWaitMinutes:
      typeof raw.copilotReviewWaitMinutes === "number" && raw.copilotReviewWaitMinutes >= 0
        ? raw.copilotReviewWaitMinutes
        : 10,
    agentExecTimeoutMinutes:
      typeof raw.agentExecTimeoutMinutes === "number" && raw.agentExecTimeoutMinutes > 0
        ? raw.agentExecTimeoutMinutes
        : 30,
    maxAgentAttemptsPerIssue:
      typeof raw.maxAgentAttemptsPerIssue === "number" && raw.maxAgentAttemptsPerIssue > 0
        ? raw.maxAgentAttemptsPerIssue
        : 30,
    timeoutRetryLimit:
      typeof raw.timeoutRetryLimit === "number" && raw.timeoutRetryLimit >= 0
        ? raw.timeoutRetryLimit
        : 2,
    blockedVerificationRetryLimit:
      typeof raw.blockedVerificationRetryLimit === "number" && raw.blockedVerificationRetryLimit >= 0
        ? raw.blockedVerificationRetryLimit
        : 3,
    sameBlockerRepeatLimit:
      typeof raw.sameBlockerRepeatLimit === "number" && raw.sameBlockerRepeatLimit >= 0
        ? raw.sameBlockerRepeatLimit
        : 2,
    sameFailureSignatureRepeatLimit:
      typeof raw.sameFailureSignatureRepeatLimit === "number" && raw.sameFailureSignatureRepeatLimit >= 0
        ? raw.sameFailureSignatureRepeatLimit
        : 3,
    maxDoneWorkspaces:
      typeof raw.maxDoneWorkspaces === "number" && Number.isFinite(raw.maxDoneWorkspaces)
        ? raw.maxDoneWorkspaces
        : 24,
    cleanupDoneWorkspacesAfterHours:
      typeof raw.cleanupDoneWorkspacesAfterHours === "number" && Number.isFinite(raw.cleanupDoneWorkspacesAfterHours)
        ? raw.cleanupDoneWorkspacesAfterHours
        : 24,
    mergeMethod:
      raw.mergeMethod === "merge" || raw.mergeMethod === "squash" || raw.mergeMethod === "rebase"
        ? raw.mergeMethod
        : "squash",
    draftPrAfterAttempt:
      typeof raw.draftPrAfterAttempt === "number" && raw.draftPrAfterAttempt >= 1
        ? raw.draftPrAfterAttempt
        : 1,
  };

  return config;
}
