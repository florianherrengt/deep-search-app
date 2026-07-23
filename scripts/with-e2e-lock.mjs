#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_DIR_NAME = "codex-e2e.lock";
const OWNER_FILE_NAME = "owner.json";
const DEFAULT_PROTECTED_PORTS = [1420, 4445];
const LOCK_RETRY_MS = 1000;
const WAIT_NOTICE_MS = 30000;
const OWNER_WRITE_GRACE_MS = 5000;
const CHILD_KILL_GRACE_MS = 5000;

async function main() {
  const command = parseCommand(process.argv.slice(2));
  const lockDir = resolveLockDir();
  const releaseLock = await acquireLock(lockDir, command);

  try {
    await assertProtectedPortsAvailable(parseProtectedPorts());
    const status = await runCommand(command);
    process.exitCode = status;
  } finally {
    await releaseLock();
  }
}

function parseCommand(args) {
  const { values, positionals } = nodeParseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // The wrapped command must follow a literal "--" separator so that any flags
  // it owns are passed through untouched rather than parsed here.
  if (!args.includes("--") || positionals.length === 0) {
    printHelp();
    throw new Error("Expected a command after --.");
  }

  return positionals;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/with-e2e-lock.mjs -- <command> [args...]

Serializes local E2E runs across Git worktrees and refuses to start while the
shared E2E ports are already occupied. The lock lives in the Git common dir.

Environment:
  DEEP_SEARCH_E2E_PROTECTED_PORTS  Comma-separated ports to preflight.
                                   Defaults to 1420,4445.
`);
}

function resolveLockDir() {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error("Could not resolve Git common dir for the E2E lock.");
  }

  const commonDir = result.stdout.trim();
  const absoluteCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.resolve(process.cwd(), commonDir);

  return path.join(absoluteCommonDir, LOCK_DIR_NAME);
}

async function acquireLock(lockDir, command) {
  let lastNoticeAt = 0;

  while (true) {
    try {
      await fs.mkdir(lockDir);
      const owner = createOwner(command);
      await writeOwner(lockDir, owner);
      console.log(`[e2e-lock] Acquired ${lockDir}`);

      return async () => {
        await releaseLock(lockDir, owner);
      };
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw error;
      }

      const owner = await readOwner(lockDir);
      if (await isStaleLock(lockDir, owner)) {
        await removeStaleLock(lockDir, owner);
        continue;
      }

      const now = Date.now();
      if (now - lastNoticeAt >= WAIT_NOTICE_MS || lastNoticeAt === 0) {
        lastNoticeAt = now;
        console.log(formatWaitMessage(lockDir, owner));
      }

      await sleep(LOCK_RETRY_MS);
    }
  }
}

function createOwner(command) {
  return {
    pid: process.pid,
    host: os.hostname(),
    cwd: process.cwd(),
    command: command.join(" "),
    startedAt: new Date().toISOString(),
  };
}

async function writeOwner(lockDir, owner) {
  await fs.writeFile(
    path.join(lockDir, OWNER_FILE_NAME),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8",
  );
}

async function readOwner(lockDir) {
  try {
    const raw = await fs.readFile(path.join(lockDir, OWNER_FILE_NAME), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function isStaleLock(lockDir, owner) {
  if (!owner || typeof owner.pid !== "number") {
    const stats = await fs.stat(lockDir).catch(() => null);
    return !stats || Date.now() - stats.mtimeMs > OWNER_WRITE_GRACE_MS;
  }

  if (owner.host && owner.host !== os.hostname()) {
    return false;
  }

  return !isProcessAlive(owner.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function removeStaleLock(lockDir, owner) {
  const label = owner?.pid ? `pid ${owner.pid}` : "unknown owner";
  console.log(`[e2e-lock] Removing stale lock from ${label}.`);
  await fs.rm(lockDir, { recursive: true, force: true });
}

function formatWaitMessage(lockDir, owner) {
  if (!owner) {
    return `[e2e-lock] Waiting for ${lockDir} to be released.`;
  }

  const details = [
    `pid ${owner.pid ?? "unknown"}`,
    owner.startedAt ? `started ${owner.startedAt}` : null,
    owner.cwd ? `cwd ${owner.cwd}` : null,
  ].filter(Boolean);

  return `[e2e-lock] Waiting for E2E lock held by ${details.join(", ")}.`;
}

async function releaseLock(lockDir, owner) {
  const currentOwner = await readOwner(lockDir);
  if (currentOwner?.pid !== owner.pid || currentOwner?.startedAt !== owner.startedAt) {
    return;
  }

  await fs.rm(lockDir, { recursive: true, force: true });
  console.log("[e2e-lock] Released lock.");
}

function parseProtectedPorts() {
  const raw = process.env.DEEP_SEARCH_E2E_PROTECTED_PORTS;
  if (!raw) return DEFAULT_PROTECTED_PORTS;

  const ports = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 65536);

  return ports.length > 0 ? ports : DEFAULT_PROTECTED_PORTS;
}

async function assertProtectedPortsAvailable(ports) {
  const busyPorts = [];

  for (const port of ports) {
    if (await isPortListening(port)) {
      busyPorts.push(port);
    }
  }

  if (busyPorts.length === 0) return;

  throw new Error(
    [
      `Refusing to start E2E because port(s) ${busyPorts.join(", ")} already have listeners.`,
      "Stop the existing dev/Tauri/E2E process first.",
      "The E2E lock only protects commands that run through this wrapper.",
    ].join(" "),
  );
}

async function isPortListening(port) {
  const checks = await Promise.all([
    canConnect(port, "127.0.0.1"),
    canConnect(port, "::1"),
  ]);

  return checks.some(Boolean);
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });

    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    const isWindows = process.platform === "win32";
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      detached: !isWindows,
      env: process.env,
      shell: isWindows,
      stdio: "inherit",
    });

    let requestedExitCode = null;
    let killTimer = null;

    const handleSignal = (signal) => {
      requestedExitCode ??= 128 + signalNumber(signal);
      console.error(`[e2e-lock] Received ${signal}; stopping child process.`);
      terminateChild(child, signal);
      killTimer ??= setTimeout(() => terminateChild(child, "SIGKILL"), CHILD_KILL_GRACE_MS);
    };

    const cleanup = () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      process.off("SIGHUP", handleSignal);
      if (killTimer) clearTimeout(killTimer);
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
    process.on("SIGHUP", handleSignal);

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });

    child.once("exit", (code, signal) => {
      cleanup();
      if (requestedExitCode !== null) {
        resolve(requestedExitCode);
        return;
      }

      if (typeof code === "number") {
        resolve(code);
        return;
      }

      resolve(128 + signalNumber(signal));
    });
  });
}

function terminateChild(child, signal) {
  if (!child.pid) return;

  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        child.kill(signal);
      } catch {}
    }
  }
}

function signalNumber(signal) {
  switch (signal) {
    case "SIGHUP":
      return 1;
    case "SIGINT":
      return 2;
    case "SIGTERM":
      return 15;
    case "SIGKILL":
      return 9;
    default:
      return 1;
  }
}

main().catch((error) => {
  console.error(`[e2e-lock] ${error?.message ?? error}`);
  process.exitCode = 1;
});
