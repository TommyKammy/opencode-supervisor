import { SupervisorConfig } from "../types";

export function summarizeGsdIntegration(config: Pick<SupervisorConfig, "gsdEnabled" | "gsdAutoInstall" | "gsdInstallScope" | "gsdPlanningFiles" | "gsdCodexConfigDir">): string {
  if (!config.gsdEnabled) {
    return "gsd=disabled";
  }

  const parts = [
    "gsd=enabled",
    `scope=${config.gsdInstallScope}`,
    `auto_install=${config.gsdAutoInstall ? "yes" : "no"}`,
    `planning_files=${config.gsdPlanningFiles.join(",") || "none"}`,
  ];

  if (config.gsdCodexConfigDir) {
    parts.push(`config_dir=${config.gsdCodexConfigDir}`);
  }

  return parts.join(" ");
}
