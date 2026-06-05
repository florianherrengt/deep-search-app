import { isTauri } from "@tauri-apps/api/core";
import { jsonSchema, tool, type ToolSet } from "ai";
import { createChromeDevToolsMcpCommand } from "./chrome-devtools-sidecar";
import {
  McpStdioClient,
  type McpToolCallResult,
  type McpToolDefinition,
} from "./mcp-stdio-client";

const TOOL_NAME_PREFIX = "chrome_devtools_";

let clientPromise: Promise<McpStdioClient> | null = null;
let toolsPromise: Promise<ToolSet> | null = null;

export async function createChromeDevToolsMcpTools({
  enabled,
}: {
  enabled: boolean;
}): Promise<ToolSet> {
  if (!enabled) {
    await shutdownChromeDevToolsMcp();
    return {};
  }

  if (!isTauri()) return {};

  toolsPromise ??= createChromeDevToolsMcpToolsInternal().catch((error) => {
    toolsPromise = null;
    console.warn("[chrome-devtools-mcp] Failed to initialize tools:", error);
    return {};
  });

  return toolsPromise;
}

export async function shutdownChromeDevToolsMcp() {
  const client = await clientPromise?.catch(() => null);
  clientPromise = null;
  toolsPromise = null;
  await client?.close();
}

async function createChromeDevToolsMcpToolsInternal(): Promise<ToolSet> {
  const client = await getChromeDevToolsMcpClient();
  const mcpTools = await client.listTools();
  const usedNames = new Set<string>();

  return Object.fromEntries(
    mcpTools.map((mcpTool) => {
      const toolName = uniqueToolName(toAiToolName(mcpTool.name), usedNames);

      return [
        toolName,
        tool({
          description: describeMcpTool(mcpTool),
          inputSchema: jsonSchema(normalizeInputSchema(mcpTool.inputSchema)),
          strict: false,
          metadata: {
            source: "chrome-devtools-mcp",
            mcpToolName: mcpTool.name,
          },
          execute: async (input) =>
            normalizeToolCallResult(
              await client.callTool(
                mcpTool.name,
                isRecord(input) ? input : {},
              ),
            ),
        }),
      ];
    }),
  ) satisfies ToolSet;
}

async function getChromeDevToolsMcpClient() {
  clientPromise ??= (async () => {
    const command = await createChromeDevToolsMcpCommand();
    const client = new McpStdioClient(command);
    await client.start();
    return client;
  })().catch((error) => {
    clientPromise = null;
    throw error;
  });

  return clientPromise;
}

function toAiToolName(mcpToolName: string) {
  return `${TOOL_NAME_PREFIX}${mcpToolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function uniqueToolName(toolName: string, usedNames: Set<string>) {
  let candidate = toolName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${toolName}_${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function describeMcpTool(mcpTool: McpToolDefinition) {
  const baseDescription = mcpTool.description?.trim() || mcpTool.name;
  return `${baseDescription}\n\nChrome DevTools MCP tool. Use only as a last resort when the internal webview/search/extraction tools cannot inspect the page well enough, or when the user explicitly asks you to control or debug their local Chrome session. Do not use for ordinary web research. Original MCP tool name: ${mcpTool.name}.`;
}

function normalizeInputSchema(inputSchema: unknown) {
  if (isRecord(inputSchema)) {
    return {
      type: "object",
      properties: {},
      ...inputSchema,
    };
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

function normalizeToolCallResult(result: McpToolCallResult) {
  return {
    isError: Boolean(result.isError),
    content: result.content ?? [],
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
