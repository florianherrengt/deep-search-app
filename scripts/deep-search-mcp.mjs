#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CONFIG_ENV = "DEEP_SEARCH_MCP_BRIDGE_CONFIG";

const deepSearchInputSchema = z
  .object({
    question: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    answers: z.array(z.string()).optional(),
  })
  .refine((value) => Boolean(value.question || value.session_id), {
    message: "Provide either question or session_id.",
  });

const cancelInputSchema = z.object({
  session_id: z.string().min(1),
});

const server = new McpServer({
  name: "deep-search",
  version: "0.1.0",
});

server.registerTool(
  "deep_search",
  {
    title: "Deep Search",
    description:
      "Run or resume a Deep Search app research session. Use { question } to start, { session_id } to poll, or { session_id, answers } to answer pending questions.",
    inputSchema: deepSearchInputSchema,
  },
  async (input) => {
    const response = await callAppBridge(input);
    return toolJson(response);
  },
);

server.registerTool(
  "deep_search_cancel",
  {
    title: "Cancel Deep Search",
    description: "Cancel a running Deep Search app research session.",
    inputSchema: cancelInputSchema,
  },
  async (input) => {
    const response = await callAppBridge({ ...input, cancel: true });
    return toolJson(response);
  },
);

await server.connect(new StdioServerTransport());

async function callAppBridge(body) {
  const config = readBridgeConfig();
  const response = await fetch(`http://127.0.0.1:${config.port}/deep-search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = parseJson(text);
  if (!response.ok) {
    const message =
      parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Deep Search bridge returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parsed ?? { status: "failed", error: "Deep Search returned invalid JSON." };
}

function readBridgeConfig() {
  const candidates = bridgeConfigCandidates();
  for (const candidate of candidates) {
    try {
      const parsed = parseJson(fs.readFileSync(candidate, "utf8"));
      if (
        parsed &&
        typeof parsed.port === "number" &&
        typeof parsed.token === "string"
      ) {
        return parsed;
      }
    } catch {
      // Try the next conventional location.
    }
  }

  throw new Error(
    `Deep Search app bridge is not available. Open Deep Search first, or set ${CONFIG_ENV} to the mcp-bridge.json path.`,
  );
}

function bridgeConfigCandidates() {
  const explicit = process.env[CONFIG_ENV];
  const candidates = explicit ? [explicit] : [];
  const home = os.homedir();

  if (process.platform === "darwin") {
    candidates.push(
      path.join(
        home,
        "Library",
        "Application Support",
        "com.deep-search-app.app",
        "mcp-bridge.json",
      ),
      path.join(
        home,
        "Library",
        "Application Support",
        "com.deep-search-app.app.dev",
        "mcp-bridge.json",
      ),
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(
        path.join(appData, "com.deep-search-app.app", "mcp-bridge.json"),
        path.join(appData, "com.deep-search-app.app.dev", "mcp-bridge.json"),
      );
    }
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    candidates.push(
      path.join(configHome, "com.deep-search-app.app", "mcp-bridge.json"),
      path.join(configHome, "com.deep-search-app.app.dev", "mcp-bridge.json"),
    );
  }

  return candidates;
}

function toolJson(value) {
  const text = JSON.stringify(value);
  return {
    content: [{ type: "text", text }],
    structuredContent: value,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
