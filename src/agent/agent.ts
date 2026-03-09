import {
  AgentCategory,
  AgentTaskOptions,
  AgentTurnResult,
  BlockedReason,
  FailureContext,
  GitHubIssue,
  GitHubPullRequest,
  IssueRunRecord,
  PullRequestCheck,
  ReasoningEffort,
  ReviewThread,
  RunState,
  SupervisorConfig,
} from "../types";
import { truncate } from "../utils";
import { runCommand } from "../utils/command";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// Global task function provided by oh-my-opencode plugin
declare const task: ((options: AgentTaskOptions) => Promise<{ sessionId: string; output: string; exitCode: number }>) | undefined;
export function extractStateHint(message: string): RunState | null {
  const match = message.match(/State hint:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as RunState;
  const supported: RunState[] = [
    "queued",
    "planning",
    "reproducing",
    "implementing",
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
  ];

  return supported.includes(value) ? value : null;
}

export function extractBlockedReason(message: string): BlockedReason {
  const match = message.match(/Blocked reason:\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].toLowerCase() as BlockedReason;
  const supported: BlockedReason[] = [
    "requirements",
    "permissions",
    "secrets",
    "verification",
    "manual_review",
    "manual_pr_closed",
    "handoff_missing",
    "unknown",
    null,
  ];
  return supported.includes(value) ? value : null;
}

export function extractFailureSignature(message: string): string | null {
  const match = message.match(/Failure signature:\s*(.+)/i);
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  if (!value || value.toLowerCase() === "none") {
    return null;
  }

  return value.slice(0, 500);
}

function phaseGuidance(state: RunState): string[] {
  if (state === "planning" || state === "reproducing") {
    return [
      "- First make the failure reproducible in a focused way before broad implementation changes.",
      "- Add or tighten the narrowest test that proves the issue before attempting full verification.",
    ];
  }

  if (state === "stabilizing") {
    return [
      "- You already have progress in the branch. Focus on turning current changes into a clean, reviewable checkpoint.",
      "- Prefer focused fixes and verification over broad rework.",
    ];
  }

  if (state === "draft_pr") {
    return [
      "- A draft PR exists or should exist. Keep changes incremental and reviewable.",
      "- Update the branch, run focused verification, and leave a clear handoff in the issue journal.",
    ];
  }

  if (state === "local_review") {
    return [
      "- A local advisory review is running for the current draft PR.",
      "- Do not change code in this phase unless a later implementation turn is explicitly triggered.",
    ];
  }

  if (state === "repairing_ci") {
    return [
      "- Treat the failing CI signal as the primary task. Fix the concrete failure instead of reshaping the feature.",
      "- Reproduce the failing command locally when possible and update the issue journal with the new result.",
    ];
  }

  if (state === "resolving_conflict") {
    return [
      "- Integrate the latest base branch, resolve conflicts conservatively, rerun focused verification, and push.",
    ];
  }

  if (state === "addressing_review") {
    return [
      "- Review threads are the primary task. Evaluate each comment, apply only valid fixes, and preserve existing behavior.",
    ];
  }

  return [];
}

function categoryToModelHint(category: AgentCategory): string {
  const hints: Record<AgentCategory, string> = {
    quick: "Use a fast, lightweight model for this task.",
    deep: "Use a thorough, analytical model for careful reasoning.",
    ultrabrain: "Use the most capable reasoning model available for complex work.",
    "visual-engineering": "Use a model with strong visual/frontend capabilities.",
    "unspecified-high": "Use a high-capability model for general complex tasks.",
    "unspecified-low": "Use an efficient model for simple tasks.",
    writing: "Use a model with strong writing and documentation capabilities.",
    artistry: "Use a creative model for unconventional problem-solving.",
  };
  return hints[category] ?? hints.deep;
}

function reasoningToModelEffort(effort: ReasoningEffort): string {
  const efforts: Record<ReasoningEffort, string> = {
    none: "Use minimal reasoning - quick responses only.",
    low: "Use light reasoning for straightforward tasks.",
    medium: "Use balanced reasoning for most tasks.",
    high: "Use deep reasoning for complex problems.",
    xhigh: "Use maximum reasoning effort for critical challenges.",
  };
  return efforts[effort] ?? efforts.medium;
}

export function buildAgentPrompt(input: {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  state: RunState;
  pr: GitHubPullRequest | null;
  checks: PullRequestCheck[];
  reviewThreads: ReviewThread[];
  alwaysReadFiles: string[];
  onDemandMemoryFiles: string[];
  journalPath: string;
  journalExcerpt?: string | null;
  failureContext?: FailureContext | null;
  previousSummary?: string | null;
  previousError?: string | null;
  category: AgentCategory;
  reasoningEffort: ReasoningEffort;
}): string {
  const checksSummary =
    input.checks.length === 0
      ? "No checks currently reported."
      : input.checks.map((check) => `- ${check.name}: ${check.bucket}/${check.state}`).join("\n");

  const prSummary = input.pr
    ? [
        `PR: #${input.pr.number} ${input.pr.url}`,
        `Draft: ${String(input.pr.isDraft)}`,
        `Review decision: ${input.pr.reviewDecision ?? "none"}`,
        `Merge state: ${input.pr.mergeStateStatus ?? "unknown"}`,
      ].join("\n")
    : "PR: none";

  const reviewSummary =
    input.reviewThreads.length === 0
      ? "No unresolved configured-bot review threads."
      : input.reviewThreads
          .map((thread) => {
            const latestComment = thread.comments.nodes[thread.comments.nodes.length - 1];
            return [
              `- Thread ${thread.id}`,
              `  File: ${thread.path ?? "unknown"}:${thread.line ?? "?"}`,
              `  Updated: ${latestComment?.createdAt ?? "unknown"}`,
              `  Reviewer: ${latestComment?.author?.login ?? "unknown"}`,
              `  Comment URL: ${latestComment?.url ?? "n/a"}`,
              `  Comment: ${latestComment?.body.replace(/\s+/g, " ").trim() ?? ""}`,
            ].join("\n");
          })
          .join("\n");

  const failureSummary = input.failureContext
    ? [
        `Category: ${input.failureContext.category ?? "unknown"}`,
        `Summary: ${input.failureContext.summary}`,
        input.failureContext.command ? `Command/source: ${input.failureContext.command}` : null,
        input.failureContext.url ? `Reference: ${input.failureContext.url}` : null,
        ...(input.failureContext.details.length > 0
          ? ["Details:", ...input.failureContext.details.map((detail) => `- ${detail}`)]
          : []),
      ]
        .filter(Boolean)
        .join("\n")
    : "No structured failure context recorded.";

  return [
    `You are operating inside a dedicated worktree for ${input.repoSlug}.`,
    `Current issue: #${input.issue.number} ${input.issue.title}`,
    `Issue URL: ${input.issue.url}`,
    `Branch: ${input.branch}`,
    `Workspace: ${input.workspacePath}`,
    `Supervisor state: ${input.state}`,
    "",
    "Model guidance:",
    `- ${categoryToModelHint(input.category)}`,
    `- ${reasoningToModelEffort(input.reasoningEffort)}`,
    "",
    "Current phase guidance:",
    ...phaseGuidance(input.state),
    "",
    "Issue body:",
    input.issue.body || "(empty)",
    "",
    prSummary,
    "",
    "Checks:",
    checksSummary,
    "",
    "Unresolved configured-bot review threads:",
    reviewSummary,
    "",
    "Structured failure context:",
    failureSummary,
    ...(input.alwaysReadFiles.length > 0
      ? [
          "",
          "Always-read memory files:",
          ...input.alwaysReadFiles.map((filePath) => `- ${filePath}`),
          "",
          "On-demand durable memory files:",
          ...(input.onDemandMemoryFiles.length > 0
            ? input.onDemandMemoryFiles.map((filePath) => `- ${filePath}`)
            : ["- none configured"]),
          "",
          "Memory policy:",
          "- Read the always-read files first.",
          "- Use the context index to decide whether you need any on-demand durable memory files.",
          "- Do not bulk-read every durable memory file on every turn.",
          "- Treat these files as the durable cross-thread memory shared by agents, CI, and future sessions.",
        ]
      : []),
    "",
    `Issue journal path: ${input.journalPath}`,
    "Read the issue journal before making changes and update its Agent Working Notes section before ending your turn.",
    ...(input.journalExcerpt
      ? ["", "Issue journal excerpt:", input.journalExcerpt]
      : []),
    ...(input.previousSummary
      ? ["", "Previous agent summary:", input.previousSummary]
      : []),
    ...(input.previousError && input.previousError !== input.previousSummary
      ? ["", "Previous blocker or failure:", input.previousError]
      : []),
    "",
    "Constraints:",
    `- Never push to ${input.repoSlug}:${input.branch === "main" ? "main" : "main"} directly.`,
    `- Work only on branch ${input.branch}.`,
    "- If implementation changes are needed, edit code, run focused verification, and commit the result.",
    "- Checkpoint commits are allowed. If you have a coherent partial checkpoint (for example a reproducing test, a review fix, or a focused implementation slice), commit it with a clear message even if the whole issue is not fully complete yet.",
    "- If CI is failing, investigate and fix the failure instead of waiting.",
    "- If the PR is ready and you need to update it, use git/gh from this workspace.",
    "- If there is no PR but the branch already contains a coherent checkpoint, open or update a draft PR early rather than waiting for full completion.",
    "- If the PR merge state is DIRTY, fetch the latest base branch, integrate it into the issue branch, resolve conflicts in this workspace, rerun focused verification, and push the updated branch.",
    "- If local verification fails, keep iterating on the implementation and tests instead of reporting blocked, unless you are truly blocked by permissions, secrets, or unclear requirements.",
    "- If you are blocked by missing permissions, missing secrets, or unclear issue requirements, say so explicitly.",
    "- Before ending the turn, update the issue journal with the current hypothesis, exact failures, commands run, and next actions.",
    "",
    "Respond in this exact footer format at the end:",
    "Summary: <short summary>",
    "State hint: <reproducing|implementing|stabilizing|draft_pr|local_review|pr_open|repairing_ci|resolving_conflict|waiting_ci|addressing_review|blocked|failed>",
    "Blocked reason: <requirements|permissions|secrets|verification|manual_review|unknown|none>",
    "Tests: <what you ran or not run>",
    "Failure signature: <stable short signature for the current primary failure or none>",
    "Next action: <next supervisor-relevant action>",
  ].join("\n");
}

export interface AgentExecutionPolicy {
  category: AgentCategory;
  reasoningEffort: ReasoningEffort;
}

const REASONING_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];

function bumpReasoningEffort(effort: ReasoningEffort, steps = 1): ReasoningEffort {
  const index = REASONING_ORDER.indexOf(effort);
  const nextIndex = Math.min(REASONING_ORDER.length - 1, Math.max(0, index) + steps);
  return REASONING_ORDER[nextIndex] ?? effort;
}

export function resolveAgentExecutionPolicy(
  config: SupervisorConfig,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
): AgentExecutionPolicy {
  const category = config.agentCategoryByState[state] ?? "deep";
  let effort = config.reasoningEffortByState[state] ?? "medium";

  if (
    config.reasoningEscalateOnRepeatedFailure &&
    record &&
    (record.repeated_failure_signature_count > 0 ||
      record.blocked_verification_retry_count > 0 ||
      record.timeout_retry_count > 0)
  ) {
    effort = bumpReasoningEffort(effort, 1);
  }

  return { category, reasoningEffort: effort };
}

// Run agent turn using opencode CLI as a subprocess
// This works without oh-my-opencode plugin
async function runAgentTurnWithCli(
  config: SupervisorConfig,
  workspacePath: string,
  prompt: string,
  category: AgentCategory,
  sessionId?: string | null,
): Promise<AgentTurnResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-supervisor-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  
  try {
    // Write prompt to file
    await fs.writeFile(promptFile, prompt, "utf8");
    
    const modelMap: Record<AgentCategory, string> = {
      quick: "opencode/gpt-5-nano",
      deep: "kimi-for-coding/k2p5",
      ultrabrain: "kimi-for-coding/kimi-k2-thinking",
      "visual-engineering": "kimi-for-coding/k2p5",
      "unspecified-high": "kimi-for-coding/k2p5",
      "unspecified-low": "opencode/gpt-5-nano",
      writing: "kimi-for-coding/k2p5",
      artistry: "kimi-for-coding/k2p5",
    };
    
    // Build opencode CLI command using 'run' subcommand
    const args = [
      "run",
      "--dir", workspacePath,
      "--file", promptFile,
      "--format", "json",
      "--model", modelMap[category] ?? modelMap.deep,
    ];
    
    if (sessionId) {
      args.push("--session", sessionId);
    }
    
    // Add prompt as message
    args.push("--", "Process this issue and implement the required changes.");
    
    console.log(`[CLI] Running: opencode ${args.join(" ")}`);
    
    // Run opencode CLI
    const result = await runCommand(
      "opencode",
      args,
      {
        cwd: workspacePath,
        allowExitCodes: [0, 1],
        timeoutMs: config.agentExecTimeoutMinutes * 60_000,
        env: {
          ...process.env,
          npm_config_yes: "true",
          CI: "1",
        },
      }
    );
    
    // Parse JSON output
    let output = result.stdout;
    let parsedOutput: { sessionId?: string; output?: string; messages?: unknown[] } = {};
    
    try {
      parsedOutput = JSON.parse(output);
    } catch {
      // Not JSON, use raw output
    }
    
    // Extract session ID
    let newSessionId = sessionId ?? null;
    if (parsedOutput.sessionId) {
      newSessionId = parsedOutput.sessionId;
    }
    
    // Extract output text
    const outputText = parsedOutput.output ?? output;
    
    return {
      exitCode: result.exitCode,
      sessionId: newSessionId,
      lastMessage: outputText.slice(-4000), // Last 4000 chars
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Mock mode for testing - just logs what would happen
async function runMockAgentTurn(
  config: SupervisorConfig,
  workspacePath: string,
  prompt: string,
  category: AgentCategory,
  sessionId?: string | null,
): Promise<AgentTurnResult> {
  console.log(`\n[MOCK AGENT TURN]`);
  console.log(`Category: ${category}`);
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Session: ${sessionId ?? "new"}`);
  console.log(`Prompt length: ${prompt.length} chars`);
  console.log(`\n--- PROMPT PREVIEW (first 500 chars) ---`);
  console.log(prompt.slice(0, 500));
  console.log(`... (${prompt.length - 500} more chars)`);
  console.log(`--- END PREVIEW ---\n`);
  
  return {
    exitCode: 0,
    sessionId: sessionId ?? `mock-${Date.now()}`,
    lastMessage: [
      "Summary: Mock agent completed successfully",
      "State hint: implementing",
      "Blocked reason: none",
      "Tests: No tests run in mock mode",
      "Failure signature: none",
      "Next action: Review the mock output and implement real agent execution",
    ].join("\n"),
    stderr: "",
    stdout: "Mock execution completed",
  };
}

// Detect available execution method
function detectExecutionMethod(): "plugin" | "cli" | "mock" {
  // Check for oh-my-opencode plugin (task function)
  if (typeof task !== "undefined") {
    return "plugin";
  }
  
  // Check if opencode CLI is available in PATH
  try {
    execSync("which opencode", { stdio: "ignore" });
    return "cli";
  } catch {
    // opencode CLI not found, fall back to mock mode
    return "mock";
  }
}

export async function runAgentTurn(
  config: SupervisorConfig,
  workspacePath: string,
  prompt: string,
  state: RunState,
  record?: Pick<IssueRunRecord, "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"> | null,
  sessionId?: string | null,
): Promise<AgentTurnResult> {
  const policy = resolveAgentExecutionPolicy(config, state, record);
  const method = detectExecutionMethod();
  
  console.log(`[Agent Execution] Method: ${method}, Category: ${policy.category}, State: ${state}`);
  
  switch (method) {
    case "plugin":
      // Use oh-my-opencode plugin's task() function
      try {
        const result = await task!({
          category: policy.category,
          prompt: prompt,
          sessionId: sessionId ?? undefined,
          runInBackground: false,
          timeoutMinutes: config.agentExecTimeoutMinutes,
        });
        
        return {
          exitCode: result.exitCode,
          sessionId: result.sessionId,
          lastMessage: result.output,
          stderr: "",
          stdout: result.output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          sessionId: sessionId ?? null,
          lastMessage: message,
          stderr: message,
          stdout: "",
        };
      }
      
    case "cli":
      // Use opencode CLI subprocess
      return runAgentTurnWithCli(config, workspacePath, prompt, policy.category, sessionId);
      
    case "mock":
    default:
      // Mock mode for testing
      return runMockAgentTurn(config, workspacePath, prompt, policy.category, sessionId);
  }
}
