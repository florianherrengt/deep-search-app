import type { SidecarCommand, SidecarChild } from "@/lib/tauri-bridge";
import { registerSidecarPid, unregisterSidecarPid } from "@/lib/tauri-bridge";
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
  /**
   * True once onclose has been delivered. Both `close()` and the sidecar's
   * "close" event can fire (kill() triggers the event, and `close()` also
   * delivers onclose directly to handle the case where no process was ever
   * spawned). Without this guard, a user-initiated close ends up firing
   * onclose twice — once from the close() body and once from the kill-induced
   * "close" event — which violates the MCP Transport contract.
   */
  private closed = false;

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
      void unregisterSidecarPid();
      this.child = null;
      this.started = false;
      console.info(
        `[sidecar] Process exited (code ${code ?? "null"}, signal ${signal ?? "null"})`,
      );
      this.emitClose(
        new Error(
          `Chrome DevTools MCP sidecar exited with code ${code ?? "null"} signal ${signal ?? "null"}.${this._stderrTail ? ` Last stderr: ${this._stderrTail}` : ""}`,
        ),
      );
      void this.dumpStderrToLogFile();
    });

    this.child = await this.command.spawn();
    console.info(
      `[sidecar] Spawned chrome-devtools-mcp sidecar (PID ${this.child.pid})`,
    );
    void registerSidecarPid(this.child.pid);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child) {
      throw new Error("Tauri stdin transport: no child process");
    }
    await this.child.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.started = false;
    void unregisterSidecarPid();
    await this.child?.kill().catch(() => {});
    this.child = null;
    // If a child was running, kill() will trigger the sidecar "close" event
    // which calls emitClose. If no child ever existed, we deliver onclose
    // ourselves here. Either way, emitClose is the single source of truth and
    // is idempotent.
    this.emitClose();
  }

  /**
   * Idempotent: delivers onclose (and optionally onerror for an unexpected
   * exit) exactly once, regardless of whether close() or the sidecar "close"
   * event fires first.
   */
  private emitClose(exitError?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (exitError) {
      this.onerror?.(exitError);
    }
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

  private async dumpStderrToLogFile() {
    if (!this._stderrTail) return;
    try {
      const { isTauri } = await import("@/lib/tauri-bridge");
      if (!isTauri()) return;
      const { writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      const logDir = await join(await appDataDir(), "sidecar-logs");
      await mkdir(logDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = await join(logDir, `sidecar-stderr-${timestamp}.log`);
      const content = `[${new Date().toISOString()}] Sidecar exited unexpectedly.\n\nStderr tail:\n${this._stderrTail}\n`;
      await writeTextFile(logPath, content);
      console.info(`[sidecar] Stderr log written to ${logPath}`);
    } catch (error) {
      console.warn("[sidecar] Failed to write stderr log file:", error);
    }
  }
}
