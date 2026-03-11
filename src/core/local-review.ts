import fs from "node:fs/promises";
import path from "node:path";
import { runAgentTurn } from "../agent/agent";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "../types";
import { ensureDir, nowIso, truncate } from "../utils";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";

export interface LocalReviewResult {
  ranAt: string;
  summaryPath: string;
  findingsPath: string;
  summary: string;
  findingsCount: number;
  maxSeverity: LocalReviewSeverity;
  recommendation: "ready" | "changes_requested" | "unknown";
  degraded: boolean;
  rawOutput: string;
}

function safeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function reviewDir(config: SupervisorConfig, issueNumber: number): string {
  return path.join(config.localReviewArtifactDir, safeSlug(config.repoSlug), `issue-${issueNumber}`);
}

function parseFooter(output: string): Pick<LocalReviewResult, "summary" | "findingsCount" | "maxSeverity" | "recommendation"> {
  const summaryMatch = output.match(/Review summary:\s*(.+)/i);
  const findingsMatch = output.match(/Findings count:\s*(\d+)/i);
  const severityMatch = output.match(/Max severity:\s*(none|low|medium|high)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? "Local review completed without a structured summary.", 500) ?? "",
    findingsCount: findingsMatch ? Number.parseInt(findingsMatch[1], 10) : 0,
    maxSeverity: (severityMatch?.[1]?.toLowerCase() as LocalReviewSeverity | undefined) ?? "none",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
  };
}

export function shouldRunLocalReview(
  config: SupervisorConfig,
  record: { local_review_head_sha: string | null },
  pr: GitHubPullRequest,
): boolean {
  return config.localReviewEnabled && pr.isDraft && record.local_review_head_sha !== pr.headRefOid;
}

function buildLocalReviewPrompt(args: {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  roles: string[];
  alwaysReadFiles: string[];
  onDemandFiles: string[];
}): string {
  const compareRef = `origin/${args.defaultBranch}...HEAD`;
  const roleList = args.roles.length > 0 ? args.roles.join(", ") : "reviewer, explorer";

  return [
    `You are performing a local pre-ready review for ${args.repoSlug}.`,
    `Issue: #${args.issue.number} ${args.issue.title}`,
    `Issue URL: ${args.issue.url}`,
    `PR: #${args.pr.number} ${args.pr.url}`,
    `Branch: ${args.branch}`,
    `Workspace: ${args.workspacePath}`,
    `Compare diff against: ${compareRef}`,
    "",
    "Goal:",
    "- Review the current branch before the draft PR is marked ready.",
    "- Focus on correctness, edge cases, config handling, state-machine safety, and tests.",
    "- Do not edit files, do not commit, and do not push.",
    "",
    "Multi-agent guidance:",
    `- If your environment supports specialized sub-agents, use a small PR-review team with roles such as: ${roleList}.`,
    "- If specialized sub-agents are not available, perform the review yourself in a single turn.",
    "",
    ...(args.alwaysReadFiles.length > 0
      ? [
          "Always-read memory files:",
          ...args.alwaysReadFiles.map((filePath) => `- ${filePath}`),
          "",
          "On-demand durable memory files:",
          ...(args.onDemandFiles.length > 0 ? args.onDemandFiles.map((filePath) => `- ${filePath}`) : ["- none configured"]),
          "",
          "Memory policy:",
          "- Read the always-read files first.",
          "- Use the context index to decide whether any on-demand file is worth opening.",
          "- Do not bulk-read every durable memory file.",
          "",
        ]
      : []),
    "Suggested commands:",
    `- git diff --stat ${compareRef}`,
    `- git diff ${compareRef}`,
    "",
    "Respond with a concise review and end with this exact footer:",
    "Review summary: <short summary>",
    "Findings count: <integer>",
    "Max severity: <none|low|medium|high>",
    "Recommendation: <ready|changes_requested>",
  ].join("\n");
}

export async function runLocalReview(args: {
  config: SupervisorConfig;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
}): Promise<LocalReviewResult> {
  const prompt = buildLocalReviewPrompt({
    repoSlug: args.config.repoSlug,
    issue: args.issue,
    branch: args.branch,
    workspacePath: args.workspacePath,
    defaultBranch: args.defaultBranch,
    pr: args.pr,
    roles: args.config.localReviewRoles,
    alwaysReadFiles: args.alwaysReadFiles,
    onDemandFiles: args.onDemandFiles,
  });

  const result = await runAgentTurn(
    args.config,
    args.workspacePath,
    prompt,
    "local_review",
    null,
    null,
  );

  const rawOutput = [result.lastMessage.trim(), result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join("\n")
    .trim();
  const parsed = parseFooter(rawOutput);
  const degraded = result.exitCode !== 0;
  const recommendation = degraded ? "unknown" : parsed.recommendation;
  const ranAt = nowIso();
  const dirPath = reviewDir(args.config, args.issue.number);
  await ensureDir(dirPath);

  const baseName = `head-${args.pr.headRefOid.slice(0, 12)}`;
  const summaryPath = path.join(dirPath, `${baseName}.md`);
  const findingsPath = path.join(dirPath, `${baseName}.json`);

  await fs.writeFile(
    summaryPath,
    [
      `# Local Review for Issue #${args.issue.number}`,
      "",
      `- PR: ${args.pr.url}`,
      `- Branch: ${args.branch}`,
      `- Head SHA: ${args.pr.headRefOid}`,
      `- Ran at: ${ranAt}`,
      `- Findings: ${parsed.findingsCount}`,
      `- Max severity: ${parsed.maxSeverity}`,
      `- Recommendation: ${recommendation}`,
      `- Degraded: ${degraded ? "yes" : "no"}`,
      "",
      rawOutput,
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    findingsPath,
    `${JSON.stringify(
      {
        issueNumber: args.issue.number,
        prNumber: args.pr.number,
        branch: args.branch,
        headSha: args.pr.headRefOid,
        ranAt,
        ...parsed,
        recommendation,
        degraded,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    ranAt,
    summaryPath,
    findingsPath,
    rawOutput,
    ...parsed,
    recommendation,
    degraded,
  };
}
