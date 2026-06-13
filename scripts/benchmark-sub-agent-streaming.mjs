#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const label = process.env.BENCHMARK_LABEL || "current";
const logDir = ".agent-logs";
const testFile = "benchmarks/sub-agent-streaming/__tests__/sub-agent-streaming-performance.test.tsx";
const vitestBin = path.join("node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const scenarioCount = 16;
const aggregatePath = path.join(logDir, `sub-agent-streaming-benchmark-${label}.json`);
const logPath = path.join(logDir, `sub-agent-streaming-benchmark-${label}.log`);

mkdirSync(logDir, { recursive: true });
writeFileSync(logPath, "");

if (!existsSync(vitestBin)) {
  console.error(`[sub-agent-benchmark] missing ${vitestBin}`);
  process.exit(1);
}

const results = [];

for (let offset = 0; offset < scenarioCount; offset += 1) {
  const outputPath = path.join(
    logDir,
    `sub-agent-streaming-benchmark-${label}-${offset}.json`,
  );
  const args = [
    "run",
    "--project",
    "unit",
    testFile,
    "--reporter=minimal",
    "--silent=false",
  ];

  if (process.env.BENCHMARK_VITEST_CONFIG) {
    args.splice(1, 0, "--config", process.env.BENCHMARK_VITEST_CONFIG);
  }

  const child = spawnSync(vitestBin, args, {
    env: {
      ...process.env,
      RUN_SUB_AGENT_BENCHMARK: "1",
      BENCHMARK_LABEL: `${label}-${offset}`,
      BENCHMARK_OFFSET: String(offset),
      BENCHMARK_LIMIT: "1",
      BENCHMARK_OUTPUT_PATH: outputPath,
    },
    encoding: "utf8",
  });

  appendLog(logPath, child.stdout);
  appendLog(logPath, child.stderr);

  if (child.status !== 0) {
    console.error(`[sub-agent-benchmark] scenario ${offset} failed; see ${logPath}`);
    process.exit(child.status ?? 1);
  }

  const scenarioResults = JSON.parse(readFileSync(outputPath, "utf8"));
  results.push(...scenarioResults);
}

writeFileSync(aggregatePath, `${JSON.stringify(results, null, 2)}\n`);

console.table(
  results.map((result) => ({
    agents: result.agents,
    sidebar: result.sidebarVisible ? "visible" : "hidden",
    mode: result.mode,
    events: result.events,
    totalMs: result.totalMs.toFixed(2),
    actionRenders: result.actionConsumerRenders,
    stateRenders: result.stateConsumerRenders,
    sidebarCommits: result.sidebarCommits,
    sidebarMs: result.sidebarActualMs.toFixed(2),
  })),
);
console.info(`[sub-agent-benchmark] wrote ${aggregatePath}`);
console.info(`[sub-agent-benchmark] raw log ${logPath}`);

function appendLog(filePath, value) {
  if (!value) return;
  writeFileSync(filePath, value, { flag: "a" });
}
