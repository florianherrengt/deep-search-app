import { describe, expect, it, vi } from "vitest";
import type { SidecarCommand, SidecarChild } from "@/lib/tauri-bridge";

vi.mock("@/lib/tauri-bridge", () => ({
  registerSidecarPid: vi.fn(async () => undefined),
  unregisterSidecarPid: vi.fn(async () => undefined),
}));

import { TauriStdioTransport } from "@/lib/mcp/tauri-stdio-transport";

function makeMockedCommand(): SidecarCommand & {
  emitClose: (code: number | null, signal: number | null) => void;
  emitError: (error: string) => void;
} {
  let closeListener: ((data: { code: number | null; signal: number | null }) => void) | null = null;
  let errorListener: ((error: string) => void) | null = null;

  const stdout = { on: vi.fn() };
  const stderr = { on: vi.fn() };
  const spawn = vi.fn(async (): Promise<SidecarChild> => ({
    pid: 12345,
    write: vi.fn(async () => undefined),
    // Mimic Tauri plugin-shell: kill() triggers the sidecar "close" event so
    // the transport sees both the direct onclose and the event-driven one.
    kill: vi.fn(async () => {
      queueMicrotask(() => closeListener?.({ code: 0, signal: null }));
    }),
  }));

  return {
    stdout,
    stderr,
    on: vi.fn((event: string, cb: never) => {
      if (event === "close") closeListener = cb as never;
      if (event === "error") errorListener = cb as never;
    }),
    spawn,
    execute: vi.fn(),
    emitClose: (code: number | null, signal: number | null) => {
      closeListener?.({ code, signal });
    },
    emitError: (error: string) => {
      errorListener?.(error);
    },
  } as unknown as SidecarCommand & {
    emitClose: (code: number | null, signal: number | null) => void;
    emitError: (error: string) => void;
  };
}

describe("TauriStdioTransport", () => {
  it("fires onclose exactly once when close() is called", async () => {
    const command = makeMockedCommand();
    const transport = new TauriStdioTransport(command);

    const onclose = vi.fn();
    const onerror = vi.fn();
    transport.onclose = onclose;
    transport.onerror = onerror;

    await transport.start();
    expect(onclose).not.toHaveBeenCalled();

    await transport.close();

    // Regression: close() used to call onclose directly AND the sidecar's
    // "close" event listener called onclose again, so consumers observed
    // two closures for a single close() call. The MCP Transport contract
    // expects onclose to fire exactly once per closure.
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("fires onclose and onerror when the sidecar crashes unexpectedly", async () => {
    const command = makeMockedCommand();
    const transport = new TauriStdioTransport(command);

    const onclose = vi.fn();
    const onerror = vi.fn();
    transport.onclose = onclose;
    transport.onerror = onerror;

    await transport.start();

    // Simulate the sidecar crashing on its own (no external close() call).
    command.emitClose(1, null);

    expect(onclose).toHaveBeenCalledTimes(1);
    // Errors are reported alongside onclose per the MCP contract so clients
    // can surface why the connection dropped.
    expect(onerror).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire onerror when close() is called after a crash", async () => {
    const command = makeMockedCommand();
    const transport = new TauriStdioTransport(command);

    const onclose = vi.fn();
    const onerror = vi.fn();
    transport.onclose = onclose;
    transport.onerror = onerror;

    await transport.start();

    // Crash first, then the consumer calls close() to clean up.
    command.emitClose(1, null);
    await transport.close();

    // The crash already closed the transport; close() must not re-emit.
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onerror).toHaveBeenCalledTimes(1);
  });
});
