import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const logDirectory = path.join(cwd, ".agent-logs");
const logPath = path.join(logDirectory, "vitest.log");
const vitestEntry = path.join(cwd, "node_modules", "vitest", "vitest.mjs");

mkdirSync(logDirectory, { recursive: true });
const logFile = openSync(logPath, "w");
const result = spawnSync(
  process.execPath,
  [
    vitestEntry,
    "run",
    "--project",
    "unit",
    "--reporter=minimal",
    "--silent=passed-only",
    "--bail=1",
    ...process.argv.slice(2),
  ],
  {
    cwd,
    stdio: ["ignore", logFile, logFile],
  },
);
closeSync(logFile);

const lines = readFileSync(logPath, "utf8").trimEnd().split(/\r?\n/);
const tail = lines.slice(-80).join("\n");
if (tail) {
  process.stdout.write(`${tail}\n`);
}

if (result.error) {
  process.stderr.write(`Failed to start Vitest: ${result.error.message}\n`);
}
if (result.signal) {
  process.stderr.write(`Vitest terminated by signal ${result.signal}.\n`);
}

process.exitCode = result.status ?? 1;
