import type { Child, Command } from "@tauri-apps/plugin-shell";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_REQUEST_TIMEOUT_MS = 30_000;
const MAX_STDERR_CHARS = 8_000;

type JsonRpcId = number;

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRequest<T = unknown> {
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface ListToolsResult {
  tools: McpToolDefinition[];
  nextCursor?: string;
}

export interface McpToolCallResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export class McpStdioClient {
  private child: Child | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrTail = "";
  private pending = new Map<JsonRpcId, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly command: Command<string>) {}

  async start() {
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  async listTools() {
    await this.start();

    const tools: McpToolDefinition[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.request<ListToolsResult>(
        "tools/list",
        cursor ? { cursor } : {},
      );
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.start();

    return this.request<McpToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
  }

  async close() {
    this.closed = true;
    this.rejectPending(new Error("MCP client closed."));
    await this.child?.kill().catch(() => {});
    this.child = null;
    this.startPromise = null;
  }

  private async startInternal() {
    this.command.stdout.on("data", (data) => this.handleStdout(data));
    this.command.stderr.on("data", (data) => this.handleStderr(data));
    this.command.on("error", (error) => {
      this.rejectPending(new Error(`Chrome DevTools MCP sidecar error: ${error}`));
      this.startPromise = null;
    });
    this.command.on("close", ({ code, signal }) => {
      const suffix = this.stderrTail ? ` Last stderr: ${this.stderrTail}` : "";
      this.rejectPending(
        new Error(
          `Chrome DevTools MCP sidecar exited with code ${code ?? "null"} signal ${signal ?? "null"}.${suffix}`,
        ),
      );
      this.child = null;
      this.startPromise = null;
    });

    this.child = await this.command.spawn();

    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "deep-search-app",
        version: "0.1.0",
      },
    });
    await this.notify("notifications/initialized", {});
  }

  private request<T>(method: string, params: Record<string, unknown>) {
    if (this.closed) {
      return Promise.reject(new Error("MCP client is closed."));
    }

    const child = this.child;
    if (!child) {
      return Promise.reject(new Error("MCP sidecar is not running."));
    }

    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Chrome DevTools MCP request timed out: ${method}${this.stderrTail ? ` Last stderr: ${this.stderrTail}` : ""}`,
          ),
        );
      }, MCP_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timeout,
      });
    });

    void child.write(`${JSON.stringify(message)}\n`).catch((error) => {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(
        error instanceof Error
          ? error
          : new Error(`Failed to write MCP request: ${String(error)}`),
      );
    });

    return promise;
  }

  private async notify(method: string, params: Record<string, unknown>) {
    const child = this.child;
    if (!child) {
      throw new Error("MCP sidecar is not running.");
    }

    await child.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      })}\n`,
    );
  }

  private handleStdout(data: string) {
    this.stdoutBuffer += data;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;

      this.handleJsonRpcLine(line);
    }
  }

  private handleJsonRpcLine(line: string) {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch (error) {
      console.warn("[chrome-devtools-mcp] Ignoring non-JSON stdout:", line, error);
      return;
    }

    if (typeof response.id !== "number") {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(
          `Chrome DevTools MCP error ${response.error.code}: ${response.error.message}`,
        ),
      );
      return;
    }

    pending.resolve(response.result as never);
  }

  private handleStderr(data: string) {
    this.stderrTail = `${this.stderrTail}${data}`.slice(-MAX_STDERR_CHARS);
    console.warn("[chrome-devtools-mcp]", data);
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
