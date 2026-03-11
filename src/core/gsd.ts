import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../utils/command";
import { SupervisorConfig } from "../types";

const REQUIRED_GSD_SKILLS = [
  "gsd-help",
  "gsd-new-project",
  "gsd-discuss-phase",
  "gsd-plan-phase",
  "gsd-execute-phase",
  "gsd-verify-work",
];
const GSD_PACKAGE_SPEC = "get-shit-done-cc@1.22.4";
const GSD_INSTALL_TIMEOUT_MS = 300_000;

function resolveCodexConfigDir(config: Pick<SupervisorConfig, "repoPath" | "gsdInstallScope" | "gsdCodexConfigDir">): string {
  if (config.gsdCodexConfigDir) {
    return config.gsdCodexConfigDir;
  }

  if (config.gsdInstallScope === "local") {
    return path.join(config.repoPath, ".codex");
  }

  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim() !== "") {
    return path.resolve(process.env.CODEX_HOME);
  }

  return path.join(os.homedir(), ".codex");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isGsdInstalled(config: Pick<SupervisorConfig, "gsdEnabled" | "repoPath" | "gsdInstallScope" | "gsdCodexConfigDir">): Promise<boolean> {
  if (!config.gsdEnabled) {
    return false;
  }

  const codexDir = resolveCodexConfigDir(config);
  for (const skillName of REQUIRED_GSD_SKILLS) {
    const skillPath = path.join(codexDir, "skills", skillName, "SKILL.md");
    if (!(await fileExists(skillPath))) {
      return false;
    }
  }

  return true;
}

export async function ensureGsdInstalled(config: Pick<SupervisorConfig, "gsdEnabled" | "gsdAutoInstall" | "repoPath" | "gsdInstallScope" | "gsdCodexConfigDir">): Promise<string | null> {
  if (!config.gsdEnabled || !config.gsdAutoInstall) {
    return null;
  }

  if (await isGsdInstalled(config)) {
    return null;
  }

  const codexDir = resolveCodexConfigDir(config);
  const args = [
    GSD_PACKAGE_SPEC,
    "--codex",
    config.gsdInstallScope === "local" ? "--local" : "--global",
  ];

  if (config.gsdInstallScope === "global") {
    args.push("--config-dir", codexDir);
  }

  await runCommand("npx", args, {
    cwd: config.repoPath,
    env: {
      ...process.env,
      CODEX_HOME:
        config.gsdInstallScope === "global" || config.gsdCodexConfigDir
          ? codexDir
          : process.env.CODEX_HOME,
      CI: "1",
      npm_config_yes: "true",
    },
    timeoutMs: GSD_INSTALL_TIMEOUT_MS,
  });

  if (!(await isGsdInstalled(config))) {
    throw new Error(`GSD install completed but required Codex skills were not found under ${codexDir}`);
  }

  return `Installed GSD Codex skills in ${codexDir}.`;
}

export function summarizeGsdIntegration(config: Pick<SupervisorConfig, "gsdEnabled" | "gsdAutoInstall" | "repoPath" | "gsdInstallScope" | "gsdPlanningFiles" | "gsdCodexConfigDir">): string {
  if (!config.gsdEnabled) {
    return "gsd=disabled";
  }

  const codexDir = resolveCodexConfigDir(config);
  const parts = [
    "gsd=enabled",
    `codex_home=${codexDir}`,
    `scope=${config.gsdInstallScope}`,
    `auto_install=${config.gsdAutoInstall ? "yes" : "no"}`,
    `planning_files=${config.gsdPlanningFiles.join(",") || "none"}`,
  ];

  return parts.join(" ");
}

export async function describeGsdIntegration(config: Pick<SupervisorConfig, "gsdEnabled" | "gsdAutoInstall" | "repoPath" | "gsdInstallScope" | "gsdPlanningFiles" | "gsdCodexConfigDir">): Promise<string> {
  const summary = summarizeGsdIntegration(config);
  if (!config.gsdEnabled) {
    return summary;
  }

  const installed = await isGsdInstalled(config);
  return `${summary} installed=${installed ? "yes" : "no"}`;
}
