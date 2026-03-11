import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/core/config";
import { runCommand } from "../src/utils/command";

const BASE_CONFIG = {
  repoPath: "/tmp/repo",
  repoSlug: "owner/repo",
  defaultBranch: "main",
  workspaceRoot: "/tmp/workspaces",
  stateFile: "/tmp/state.json",
  branchPrefix: "opencode/issue-",
};

async function withTempConfig(
  payload: string,
  run: (configPath: string) => Promise<void> | void,
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-test-"));
  const configPath = path.join(tempDir, "supervisor.config.json");
  try {
    await fs.writeFile(configPath, payload, "utf8");
    await run(configPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("loadConfig rejects invalid repoSlug with field-specific error", async () => {
  await withTempConfig(
    JSON.stringify({ ...BASE_CONFIG, repoSlug: "invalid" }),
    (configPath) => {
      assert.throws(() => loadConfig(configPath), /Invalid config field: repoSlug/);
    },
  );
});

test("loadConfig rejects invalid defaultBranch with field-specific error", async () => {
  await withTempConfig(
    JSON.stringify({ ...BASE_CONFIG, defaultBranch: "feature..bad" }),
    (configPath) => {
      assert.throws(() => loadConfig(configPath), /Invalid config field: defaultBranch/);
    },
  );
});

test("loadConfig rejects invalid branchPrefix with field-specific error", async () => {
  await withTempConfig(
    JSON.stringify({ ...BASE_CONFIG, branchPrefix: "bad prefix" }),
    (configPath) => {
      assert.throws(() => loadConfig(configPath), /Invalid config field: branchPrefix/);
    },
  );
});

test("loadConfig surfaces JSON parse diagnostics with source path context", async () => {
  await withTempConfig(
    "{\"repoPath\":\"/tmp/repo\",",
    (configPath) => {
      assert.throws(
        () => loadConfig(configPath),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(`^Failed to parse JSON from ${configPath.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}:`));
          return true;
        },
      );
    },
  );
});

test("runCommand classifies timeout failures deterministically", async () => {
  await assert.rejects(
    () => runCommand("node", ["-e", "setTimeout(() => {}, 500)"], { timeoutMs: 50 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Command timed out: node -e setTimeout\(\(\) => \{\}, 500\)/);
      return true;
    },
  );
});

test("runCommand classifies signal termination deterministically", async () => {
  await assert.rejects(
    () => runCommand("node", ["-e", "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10)"], { timeoutMs: 2_000 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Command terminated by signal SIGTERM: node -e setTimeout\(\(\) => process\.kill\(process\.pid, 'SIGTERM'\), 10\)/);
      return true;
    },
  );
});

test("runCommand classifies spawn failures deterministically", async () => {
  await assert.rejects(
    () => runCommand("command-that-does-not-exist-opencode", []),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Failed to spawn command: command-that-does-not-exist-opencode$/);
      return true;
    },
  );
});

test("loadConfig defaults done-workspace retention controls", async () => {
  await withTempConfig(
    JSON.stringify(BASE_CONFIG),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        maxDoneWorkspaces: number;
        cleanupDoneWorkspacesAfterHours: number;
      };
      assert.equal(config.maxDoneWorkspaces, 24);
      assert.equal(config.cleanupDoneWorkspacesAfterHours, 24);
    },
  );
});

test("loadConfig keeps explicit done-workspace retention boundary values", async () => {
  await withTempConfig(
    JSON.stringify({
      ...BASE_CONFIG,
      maxDoneWorkspaces: 0,
      cleanupDoneWorkspacesAfterHours: -1,
    }),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        maxDoneWorkspaces: number;
        cleanupDoneWorkspacesAfterHours: number;
      };
      assert.equal(config.maxDoneWorkspaces, 0);
      assert.equal(config.cleanupDoneWorkspacesAfterHours, -1);
    },
  );
});

test("loadConfig defaults GSD integration fields to disabled with planning files", async () => {
  await withTempConfig(
    JSON.stringify(BASE_CONFIG),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        gsdEnabled: boolean;
        gsdAutoInstall: boolean;
        gsdInstallScope: string;
        gsdPlanningFiles: string[];
      };
      assert.equal(config.gsdEnabled, false);
      assert.equal(config.gsdAutoInstall, false);
      assert.equal(config.gsdInstallScope, "global");
      assert.deepEqual(config.gsdPlanningFiles, ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"]);
    },
  );
});

test("loadConfig parses explicit GSD integration fields and filters planning files", async () => {
  await withTempConfig(
    JSON.stringify({
      ...BASE_CONFIG,
      gsdEnabled: true,
      gsdAutoInstall: true,
      gsdInstallScope: "local",
      gsdCodexConfigDir: "./.codex",
      gsdPlanningFiles: ["PROJECT.md", "", 123, "STATE.md"],
    }),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        gsdEnabled: boolean;
        gsdAutoInstall: boolean;
        gsdInstallScope: string;
        gsdCodexConfigDir?: string;
        gsdPlanningFiles: string[];
      };
      assert.equal(config.gsdEnabled, true);
      assert.equal(config.gsdAutoInstall, true);
      assert.equal(config.gsdInstallScope, "local");
      assert.ok(config.gsdCodexConfigDir?.endsWith(`${path.sep}.codex`));
      assert.deepEqual(config.gsdPlanningFiles, ["PROJECT.md", "STATE.md"]);
    },
  );
});

test("loadConfig defaults localReviewConfidenceThreshold to 0.7", async () => {
  await withTempConfig(
    JSON.stringify(BASE_CONFIG),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        localReviewConfidenceThreshold: number;
      };
      assert.equal(config.localReviewConfidenceThreshold, 0.7);
    },
  );
});

test("loadConfig keeps valid localReviewConfidenceThreshold and falls back for invalid values", async () => {
  await withTempConfig(
    JSON.stringify({
      ...BASE_CONFIG,
      localReviewConfidenceThreshold: 0.9,
    }),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        localReviewConfidenceThreshold: number;
      };
      assert.equal(config.localReviewConfidenceThreshold, 0.9);
    },
  );

  await withTempConfig(
    JSON.stringify({
      ...BASE_CONFIG,
      localReviewConfidenceThreshold: 1.1,
    }),
    (configPath) => {
      const config = loadConfig(configPath) as unknown as {
        localReviewConfidenceThreshold: number;
      };
      assert.equal(config.localReviewConfidenceThreshold, 0.7);
    },
  );
});
