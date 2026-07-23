import { isTauri } from "@/lib/tauri-bridge";
import { isRecord } from "@/lib/json";
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TauriStdioTransport } from "./tauri-stdio-transport";
import { createChromeDevToolsMcpCommand } from "./chrome-devtools-sidecar";
import type { ChromeMcpConnectionMode } from "@/lib/settings-store";
import { abortablePromise, throwIfAborted } from "@/lib/abort";
import PQueue from "p-queue";

const TOOL_NAME_PREFIX = "chrome_devtools_";
const MCP_REQUEST_TIMEOUT_MS = 30_000;

let clientPromise: Promise<Client> | null = null;
let transportRef: TauriStdioTransport | null = null;
let toolsPromise: Promise<ToolSet> | null = null;
let activeConnectionKey: string | null = null;

// Serialized (concurrency 1) queue so MCP tool calls run one at a time.
const chromeDevToolsOperations = new PQueue({ concurrency: 1 });

interface ChromeMcpConnection {
  connectionMode?: ChromeMcpConnectionMode;
  browserUrl?: string;
  nodePath?: string;
}

export async function createChromeDevToolsMcpTools({
  enabled,
  connectionMode,
  browserUrl,
  nodePath,
}: {
  enabled: boolean;
  connectionMode?: ChromeMcpConnectionMode;
  browserUrl?: string;
  nodePath?: string;
}): Promise<ToolSet> {
  if (!enabled) {
    await shutdownChromeDevToolsMcp();
    return {};
  }

  if (!isTauri()) return {};

  try {
    return await withChromeDevToolsMcpClient(
      { connectionMode, browserUrl, nodePath },
      async (client) => {
        toolsPromise ??= createChromeDevToolsMcpToolsInternal(client).catch(
          (error) => {
            toolsPromise = null;
            console.warn(
              "[chrome-devtools-mcp] Failed to initialize tools:",
              error,
            );
            return {};
          },
        );

        return toolsPromise;
      },
    );
  } catch (error) {
    console.warn("[chrome-devtools-mcp] Failed to initialize tools:", error);
    return {};
  }
}

export async function shutdownChromeDevToolsMcp() {
  return chromeDevToolsOperations.add(
    shutdownChromeDevToolsMcpUnserialized,
  );
}

async function shutdownChromeDevToolsMcpUnserialized() {
  const client = await clientPromise?.catch(() => null);
  clientPromise = null;
  transportRef = null;
  toolsPromise = null;
  activeConnectionKey = null;
  await client?.close();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void shutdownChromeDevToolsMcp();
  });
}

async function createChromeDevToolsMcpToolsInternal(client: Client): Promise<ToolSet> {
  const { tools: mcpTools } = await client.listTools(undefined, {
    timeout: MCP_REQUEST_TIMEOUT_MS,
  });
  const usedNames = new Set<string>();

  return Object.fromEntries(
    mcpTools.map((mcpTool: { name: string; description?: string; inputSchema: { type: string; properties?: Record<string, object>; required?: string[] } }) => {
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
          execute: async (input, options) =>
            chromeDevToolsOperations.add(async () => {
              try {
                return normalizeToolCallResult(
                  await client.callTool(
                    { name: mcpTool.name, arguments: isRecord(input) ? input : {} },
                    undefined,
                    { timeout: MCP_REQUEST_TIMEOUT_MS },
                  ) as { content?: unknown[]; structuredContent?: unknown; isError?: boolean },
                );
              } catch (error) {
                const tail = transportRef?.stderrTail;
                if (tail) {
                  throw new Error(
                    `${error instanceof Error ? error.message : String(error)} Last stderr: ${tail}`,
                  );
                }
                throw error;
              }
            }, options?.abortSignal ? { signal: options.abortSignal } : undefined),
        }),
      ];
    }),
  ) satisfies ToolSet;
}

export function withChromeDevToolsMcpClient<T>(
  connection: ChromeMcpConnection,
  operation: (client: Client) => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  return chromeDevToolsOperations.add(async () => {
    const client = await abortablePromise(
      getChromeDevToolsMcpClientUnserialized(connection),
      abortSignal,
    );
    throwIfAborted(abortSignal);
    return operation(client);
  }, abortSignal ? { signal: abortSignal } : undefined);
}

async function getChromeDevToolsMcpClientUnserialized(
  connection: { connectionMode?: ChromeMcpConnectionMode; browserUrl?: string; nodePath?: string },
): Promise<Client> {
  // Keep reconnection validation at the client boundary so direct consumers and
  // dynamically exposed tools both honor configuration changes.
  const connectionKey = [
    connection.connectionMode === "browser-url"
      ? `browser-url:${connection.browserUrl?.trim() ?? ""}`
      : "auto-connect",
    `node:${connection.nodePath?.trim() ?? "auto"}`,
  ].join("|");
  if (activeConnectionKey !== null && activeConnectionKey !== connectionKey) {
    await shutdownChromeDevToolsMcpUnserialized();
  }
  activeConnectionKey = connectionKey;

  clientPromise ??= (async () => {
    const command = await createChromeDevToolsMcpCommand({
      mode: connection.connectionMode,
      browserUrl: connection.browserUrl,
      nodePath: connection.nodePath,
    });
    const transport = new TauriStdioTransport(command);
    transportRef = transport;
    const client = new Client(
      { name: "deep-search-app", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport, { timeout: MCP_REQUEST_TIMEOUT_MS });
    return client;
  })().catch((error) => {
    clientPromise = null;
    transportRef = null;
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

function describeMcpTool(mcpTool: { name: string; description?: string }) {
  const baseDescription = mcpTool.description?.trim() || mcpTool.name;
  return `${baseDescription}\n\nChrome DevTools MCP tool. Use only as a last resort when the internal webview/search/extraction tools cannot inspect the page well enough, or when the user explicitly asks you to control or debug their local Chrome session. Do not use for ordinary web research. Original MCP tool name: ${mcpTool.name}.`;
}

function normalizeInputSchema(inputSchema: unknown): JSONSchema7 {
  if (isRecord(inputSchema)) {
    return {
      type: "object",
      properties: {},
      ...inputSchema,
    } as JSONSchema7;
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

function normalizeToolCallResult(result: {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}) {
  return {
    isError: Boolean(result.isError),
    content: result.content ?? [],
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
  };
}
