import type { SidecarCommand, SidecarChild } from "@/lib/tauri-bridge";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const MAX_STDERR_CHARS = 8_000;

export class TauriStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  private child: SidecarChild | null = null;
  private stdoutBuffer = "";
  private _stderrTail = "";
  private started = false;

  constructor(private readonly command: SidecarCommand) {}

  get stderrTail(): string {
    return this._stderrTail;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.command.stdout.on("data", (data: string) => this.handleStdout(data));
    this.command.stderr.on("data", (data: string) => this.handleStderr(data));
    this.command.on("error", (error: string) => {
      this.onerror?.(
        new Error(`Chrome DevTools MCP sidecar error: ${error}`),
      );
    });
    this.command.on("close", ({ code, signal }) => {
      this.child = null;
      this.started = false;
      this.onclose?.();
      this.onerror?.(
        new Error(
          `Chrome DevTools MCP sidecar exited with code ${code ?? "null"} signal ${signal ?? "null"}.${this._stderrTail ? ` Last stderr: ${this._stderrTail}` : ""}`,
        ),
      );
    });

    this.child = await this.command.spawn();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child) {
      throw new Error("Tauri stdin transport: no child process");
    }
    await this.child.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    this.started = false;
    await this.child?.kill().catch(() => {});
    this.child = null;
    this.onclose?.();
  }

  private handleStdout(data: string) {
    this.stdoutBuffer += data;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JSONRPCMessage;
        this.onmessage?.(message);
      } catch (error) {
        console.warn(
          "[chrome-devtools-mcp] Ignoring non-JSON stdout:",
          line,
          error,
        );
      }
    }
  }

  private handleStderr(data: string) {
    this._stderrTail = `${this._stderrTail}${data}`.slice(-MAX_STDERR_CHARS);
    console.warn("[chrome-devtools-mcp]", data);
  }
}
