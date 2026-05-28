// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getBytebellHome } from "@bb/config";
import { DockerComposeError, DockerNotFoundError, composeFilePath, down } from "./dockerInfra.ts";
import { createSpinner, error, success } from "./output.ts";
import { promptStopDocker } from "./shutdownPrompts.ts";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

interface ShutdownOptions {
  withDocker?: boolean;
  keepDocker?: boolean;
}

export function buildShutdownCommand(): Command {
  const cmd = new Command("shutdown");
  cmd
    .description("Stop the bytebell-server (and optionally Docker infra).")
    .option("--with-docker", "also stop Docker infra without prompting")
    .option("--keep-docker", "leave Docker infra running without prompting")
    .action((opts: ShutdownOptions) => runShutdown(opts));
  return cmd;
}

async function runShutdown(opts: ShutdownOptions): Promise<void> {
  if (opts.withDocker === true && opts.keepDocker === true) {
    error("--with-docker and --keep-docker are mutually exclusive.");
    process.exitCode = 1;
    return;
  }

  const pidFile = path.join(getBytebellHome(), "pid");
  const pid = await readPid(pidFile);
  if (pid === null) {
    success("server is not running.");
    process.stdout.write(dockerHint());
    return;
  }

  const spinner = createSpinner("Shutting down ByteBell server...");
  try {
    process.kill(pid, "SIGTERM");
  } catch (cause: unknown) {
    const code = (cause as { code?: string } | undefined)?.code;
    if (code === "ESRCH") {
      spinner.stop(true, "server pid file was stale; nothing to stop.");
      process.stdout.write(dockerHint());
      return;
    }
    spinner.stop(false, "Failed to send SIGTERM");
    error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
    return;
  }

  const drained = await waitForPidFileGone(pidFile);
  if (!drained) {
    spinner.stop(
      false,
      `server (pid ${pid}) did not exit within ${POLL_TIMEOUT_MS / 1000}s; not escalating to SIGKILL.`,
    );
    process.exitCode = 1;
    process.stdout.write(dockerHint());
    return;
  }
  spinner.stop(true, `server (pid ${pid}) shut down gracefully.`);

  const shouldStop = await decideStopDocker(opts);
  if (shouldStop) {
    await stopDocker();
  } else {
    process.stdout.write(dockerHint());
  }
}

async function decideStopDocker(opts: ShutdownOptions): Promise<boolean> {
  if (opts.withDocker === true) {
    return true;
  }
  if (opts.keepDocker === true) {
    return false;
  }
  if (process.stdin.isTTY !== true) {
    return false;
  }
  return promptStopDocker();
}

async function stopDocker(): Promise<void> {
  const spinner = createSpinner("Stopping Docker infrastructure...");
  try {
    await down();
    spinner.stop(true, "Docker infra stopped.");
  } catch (cause: unknown) {
    spinner.stop(false, "Docker shutdown failed");
    if (cause instanceof DockerNotFoundError) {
      error(cause.message);
    } else if (cause instanceof DockerComposeError) {
      error(cause.message);
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
    process.stdout.write(dockerHint());
  }
}

export async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = await readFile(pidFile, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function waitForPidFileGone(pidFile: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (!(await pidFileExists(pidFile))) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return !(await pidFileExists(pidFile));
}

async function pidFileExists(pidFile: string): Promise<boolean> {
  try {
    await stat(pidFile);
    return true;
  } catch {
    return false;
  }
}

function dockerHint(): string {
  return `\nDocker infra is still running. To stop it:\n  docker compose -f ${composeFilePath()} down\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
