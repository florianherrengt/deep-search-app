#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_ENV = "DEEP_SEARCH_MCP_BRIDGE_CONFIG";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
]);

const TOOLS = [
  {
    name: "deep_search",
    title: "Deep Search",
    description:
      "Run or resume a Deep Search app research session. Use { question } to start, { session_id } to poll, or { session_id, question } after done to ask a follow-up. If the response status is running, call this tool again with the same session_id until it returns done, failed, or cancelled. Deep Search MCP does not ask clarification questions; the app skips them and continues.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1 },
        session_id: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "deep_search_cancel",
    title: "Cancel Deep Search",
    description: "Cancel a running Deep Search app research session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", minLength: 1 },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
];

let inputBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  processInputBuffer();
});
process.stdin.on("error", (error) => {
  logError(error);
});

function processInputBuffer() {
  while (true) {
    const newlineIndex = inputBuffer.indexOf("\n");
    if (newlineIndex === -1) return;

    const line = inputBuffer.slice(0, newlineIndex).replace(/\r$/, "");
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;

    void handleLine(line);
  }
}

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeError(null, -32700, `Parse error: ${errorMessage(error)}`);
    return;
  }

  if (!isJsonRpcMessage(message)) {
    writeError(null, -32600, "Invalid JSON-RPC message.");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    await handleNotification(message);
    return;
  }

  try {
    const result = await handleRequest(message);
    writeMessage({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeError(
      message.id,
      error && typeof error === "object" && "code" in error
        ? Number(error.code)
        : -32000,
      errorMessage(error),
    );
  }
}

async function handleNotification(message) {
  if (message.method === "notifications/initialized") return;
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "deep-search", version: "0.1.0" },
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(message.params);
    default:
      throw rpcError(-32601, `Method not found: ${message.method}`);
  }
}

async function callTool(params) {
  const name = params?.name;
  const args = isRecord(params?.arguments) ? params.arguments : {};

  if (name === "deep_search") {
    validateDeepSearchInput(args);
    return toolJson(await callAppBridge(args));
  }

  if (name === "deep_search_cancel") {
    validateCancelInput(args);
    return toolJson(await callAppBridge({ ...args, cancel: true }));
  }

  throw rpcError(-32602, `Unknown tool: ${String(name)}`);
}

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

function validateDeepSearchInput(input) {
  if (Array.isArray(input.answers)) {
    throw rpcError(
      -32602,
      "Question answers are no longer supported. Deep Search MCP skips clarification questions and continues automatically.",
    );
  }
  if (typeof input.question === "string" && input.question.trim()) return;
  if (typeof input.session_id === "string" && input.session_id.trim()) return;
  throw rpcError(-32602, "Provide either question or session_id.");
}

function validateCancelInput(input) {
  if (typeof input.session_id === "string" && input.session_id.trim()) return;
  throw rpcError(-32602, "session_id is required.");
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
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.join(scriptDir, "mcp-bridge.json"));

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
  return {
    content: [{ type: "text", text: formatToolResultText(value) }],
    structuredContent: isRecord(value) ? value : { value },
  };
}

function formatToolResultText(value) {
  const json = JSON.stringify(value);
  if (!isRecord(value) || typeof value.status !== "string") return json;

  const sessionId =
    typeof value.session_id === "string" ? value.session_id : "<session_id>";

  if (value.status === "running") {
    return [
      "Deep Search is still running.",
      `Next step: call deep_search again with {"session_id":"${sessionId}"} until status is done, failed, or cancelled.`,
      "",
      json,
    ].join("\n");
  }

  if (value.status === "done") {
    return [
      "Deep Search is done.",
      `Follow-up: call deep_search with {"session_id":"${sessionId}","question":"..."}.`,
      "",
      json,
    ].join("\n");
  }

  if (value.status === "failed") {
    return ["Deep Search failed.", "", json].join("\n");
  }

  if (value.status === "cancelled") {
    return ["Deep Search was cancelled.", "", json].join("\n");
  }

  return json;
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function isJsonRpcMessage(value) {
  return isRecord(value) && value.jsonrpc === "2.0" && typeof value.method === "string";
}

function rpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function logError(error) {
  process.stderr.write(`[deep-search-mcp] ${errorMessage(error)}\n`);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
