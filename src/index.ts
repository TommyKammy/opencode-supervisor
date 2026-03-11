import { Supervisor } from "./core/supervisor";
import { ensureGsdInstalled } from "./core/gsd";
import { CliOptions } from "./types";
import { sleep } from "./utils";

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let command: CliOptions["command"] = "run-once";
  let configPath: string | undefined;
  let dryRun = false;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "run-once" || token === "loop" || token === "status") {
      command = token;
      continue;
    }

    if (token === "--config") {
      configPath = args.shift();
      continue;
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, configPath, dryRun };
}

async function runOnceWithSupervisorLock(
  supervisor: Supervisor,
  command: "loop" | "run-once",
  options: Pick<CliOptions, "dryRun">,
): Promise<string> {
  const lock = await supervisor.acquireSupervisorLock(command);
  if (!lock.acquired) {
    return `Skipped supervisor cycle: ${lock.reason}.`;
  }

  try {
    return await supervisor.runOnce(options);
  } finally {
    await lock.release();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supervisor = Supervisor.fromConfig(options.configPath);

  if (options.command !== "status") {
    const installMessage = await ensureGsdInstalled(supervisor.config);
    if (installMessage) {
      console.log(installMessage);
    }
  }

  if (options.command === "status") {
    console.log(await supervisor.status());
    return;
  }

  await supervisor.validateRuntimePrerequisites();
  const pollIntervalMs = supervisor.pollIntervalMs();

  if (options.command === "run-once") {
    console.log(await runOnceWithSupervisorLock(supervisor, "run-once", { dryRun: options.dryRun }));
    return;
  }

  const sleepAbortController = new AbortController();
  let shutdownSignal: NodeJS.Signals | null = null;
  const onShutdownSignal = (signal: NodeJS.Signals): void => {
    if (shutdownSignal) {
      return;
    }
    shutdownSignal = signal;
    console.log(`${new Date().toISOString()} loop-shutdown requested via ${signal}; exiting after current cycle`);
    sleepAbortController.abort();
  };
  const sigintHandler = (): void => onShutdownSignal("SIGINT");
  const sigtermHandler = (): void => onShutdownSignal("SIGTERM");
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  try {
    while (true) {
      try {
        const message = await runOnceWithSupervisorLock(supervisor, "loop", { dryRun: options.dryRun });
        console.log(`${new Date().toISOString()} ${message}`);
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(`${new Date().toISOString()} loop-error ${message}`);
      }

      if (shutdownSignal) {
        break;
      }

      await sleep(pollIntervalMs, { signal: sleepAbortController.signal });
      if (shutdownSignal) {
        break;
      }
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
  }

  if (shutdownSignal) {
    console.log(`${new Date().toISOString()} loop-shutdown complete via ${shutdownSignal}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
