import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env");

const envContent = readFileSync(envPath, "utf-8");
const apiKey = envContent
  .split("\n")
  .find((line) => line.startsWith("Z_AI_API_KEY="))
  ?.split("=", 2)[1]
  ?.trim();

if (!apiKey) {
  console.error("Z_AI_API_KEY not found in .env");
  process.exit(1);
}

const res = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
  headers: { Authorization: `Bearer ${apiKey}` },
});

if (!res.ok) {
  console.error(`API error: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const json = await res.json();
const now = Date.now();

function pad(n) {
  return String(n).padStart(2, "0");
}

function atFormat(date) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${hh}:${min} ${yyyy}-${mm}-${dd}`;
}

for (const limit of json.data.limits) {
  const { type, nextResetTime, percentage } = limit;

  if (nextResetTime) {
    const date = new Date(nextResetTime);
    const stale = date.getTime() < now;
    console.log(`${atFormat(date)}  ${type} (${percentage}%)${stale ? "  STALE" : ""}`);
  } else {
    console.log(`-                 ${type} (${percentage}%)  no active window`);
  }
}
