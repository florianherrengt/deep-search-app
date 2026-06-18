#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "..", "src", "lib", "transport");

const PROMPTS = {
  "chat-title": {
    path: join(promptsDir, "chat-title-prompt.md"),
    label: "Chat title generation",
  },
  "title-slug": {
    path: join(promptsDir, "title-slug-prompt.md"),
    label: "Title → kebab-case slug",
  },
};

const promptName = process.argv[2];
const userMessage = process.argv[3];

if (!promptName || promptName === "--list" || promptName === "-l") {
  console.log("Available prompts:\n");
  for (const [name, { label }] of Object.entries(PROMPTS)) {
    console.log(`  ${name.padEnd(16)} ${label}`);
  }
  console.log("\nUsage: node scripts/test-prompt.mjs <prompt-name> \"<message>\"");
  process.exit(0);
}

const entry = PROMPTS[promptName];
if (!entry) {
  console.error(`Unknown prompt: ${promptName}`);
  console.error(`Available: ${Object.keys(PROMPTS).join(", ")}`);
  process.exit(1);
}

if (!userMessage) {
  console.error("Missing message. Usage: node scripts/test-prompt.mjs <prompt-name> \"<message>\"");
  process.exit(1);
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY not set in .env");
  process.exit(1);
}

const system = readFileSync(entry.path, "utf-8");
const model = createDeepSeek({ apiKey })("deepseek-v4-flash");

const providerOptions = {
  deepseek: { thinking: { type: "disabled" } },
};

try {
  const result = await generateText({
    model,
    system,
    prompt: userMessage,
    maxOutputTokens: 120,
    providerOptions,
  });

  console.log(`${entry.label}`);
  console.log(`  Input:  ${userMessage}`);
  console.log(`  Output: ${result.text.trim()}`);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
