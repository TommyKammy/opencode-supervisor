import fs from "node:fs/promises";
import path from "node:path";
import { runAgentTurn } from "../agent/agent";
import { GitHubIssue, GitHubPullRequest, SupervisorConfig } from "../types";
import { ensureDir, nowIso, truncate } from "../utils";

export type LocalReviewSeverity = "none" | "low" | "medium" | "high";
type ActionableSeverity = Exclude<LocalReviewSeverity, "none">;

export interface LocalReviewFinding {
  title: string;
  body: string;
  severity: ActionableSeverity;
  confidence: number;
  file: string | null;
  start: number | null;
  end: number | null;
}

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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSeverity(value: unknown): ActionableSeverity | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeFinding(value: unknown): LocalReviewFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? normalizeWhitespace(record.title) : "";
  const body = typeof record.body === "string" ? normalizeWhitespace(record.body) : "";
  const severity = normalizeSeverity(record.severity);
  const confidence = normalizeConfidence(record.confidence);
  if (!title || !body || !severity || confidence === null) {
    return null;
  }

  let start =
    typeof record.start === "number" && Number.isInteger(record.start) && record.start > 0
      ? record.start
      : null;
  let end =
    typeof record.end === "number" && Number.isInteger(record.end) && record.end > 0
      ? record.end
      : start;

  if (start === null && end !== null) {
    start = end;
  }

  return {
    title,
    body,
    severity,
    confidence,
    file: typeof record.file === "string" && record.file.trim() !== "" ? record.file.trim() : null,
    start,
    end,
  };
}

function maxSeverity(findings: Pick<LocalReviewFinding, "severity">[]): LocalReviewSeverity {
  if (findings.some((finding) => finding.severity === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.severity === "medium")) {
    return "medium";
  }
  if (findings.some((finding) => finding.severity === "low")) {
    return "low";
  }

  return "none";
}

function parseFooter(output: string): {
  summary: string;
  reportedFindingsCount: number;
  maxSeverity: LocalReviewSeverity;
  recommendation: LocalReviewResult["recommendation"];
  findings: LocalReviewFinding[];
  hasStructuredFindingsPayload: boolean;
} {
  const summaryMatch = output.match(/Review summary:\s*(.+)/i);
  const findingsMatch = output.match(/Findings count:\s*(\d+)/i);
  const severityMatch = output.match(/Max severity:\s*(none|low|medium|high)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);
  const jsonMatch = output.match(/REVIEW_FINDINGS_JSON_START\s*([\s\S]*?)\s*REVIEW_FINDINGS_JSON_END/i);

  let findings: LocalReviewFinding[] = [];
  let hasStructuredFindingsPayload = false;

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.findings)) {
        hasStructuredFindingsPayload = true;
        findings = parsed.findings
          .map((item) => normalizeFinding(item))
          .filter((item): item is LocalReviewFinding => item !== null);
      }
    } catch {
      findings = [];
    }
  }

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? "Local review completed without a structured summary.", 500) ?? "",
    reportedFindingsCount: findingsMatch ? Number.parseInt(findingsMatch[1], 10) : 0,
    maxSeverity: (severityMatch?.[1]?.toLowerCase() as LocalReviewSeverity | undefined) ?? "none",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
    findings,
    hasStructuredFindingsPayload,
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
  confidenceThreshold: number;
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
    "Structured findings format:",
    `- Treat findings with confidence >= ${args.confidenceThreshold.toFixed(2)} as actionable.`,
    "- Include all findings in a JSON object between exact markers:",
    "  REVIEW_FINDINGS_JSON_START",
    '  {"findings":[{"title":"...","body":"...","severity":"low|medium|high","confidence":0.0,"file":"path","start":1,"end":1}]}',
    "  REVIEW_FINDINGS_JSON_END",
    "- Return an empty findings array when there are no actionable findings.",
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
    confidenceThreshold: args.config.localReviewConfidenceThreshold,
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
  const actionableFindings = parsed.findings.filter(
    (finding) => finding.confidence >= args.config.localReviewConfidenceThreshold,
  );
  const useThresholdFiltering = parsed.hasStructuredFindingsPayload;
  const findingsCount = useThresholdFiltering ? actionableFindings.length : parsed.reportedFindingsCount;
  const effectiveMaxSeverity = useThresholdFiltering ? maxSeverity(actionableFindings) : parsed.maxSeverity;
  const recommendation = degraded
    ? "unknown"
    : useThresholdFiltering
      ? findingsCount > 0
        ? "changes_requested"
        : "ready"
      : parsed.recommendation;
  const summary = useThresholdFiltering
    ? truncate(
        `${parsed.summary} Actionable findings above confidence ${args.config.localReviewConfidenceThreshold.toFixed(2)}: ${findingsCount}.`,
        500,
      ) ?? ""
    : parsed.summary;
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
      `- Confidence threshold: ${args.config.localReviewConfidenceThreshold.toFixed(2)}`,
      `- Actionable findings: ${findingsCount}`,
      `- Max severity: ${effectiveMaxSeverity}`,
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
        confidenceThreshold: args.config.localReviewConfidenceThreshold,
        summary,
        reportedFindingsCount: parsed.reportedFindingsCount,
        findingsCount,
        actionableFindingsCount: findingsCount,
        maxSeverity: effectiveMaxSeverity,
        parsedFindings: parsed.findings,
        actionableFindings,
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
    summary,
    findingsCount,
    maxSeverity: effectiveMaxSeverity,
    recommendation,
    degraded,
  };
}
