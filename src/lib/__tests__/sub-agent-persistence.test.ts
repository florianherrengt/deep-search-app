import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubAgentRun } from "@/lib/sub-agent-types";

const mockReadAppFile = vi.hoisted(() => vi.fn());
const mockWriteAppFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app-file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-file-storage")>();
  return {
    ...actual,
    readAppFile: mockReadAppFile,
    writeAppFile: mockWriteAppFile,
  };
});

import { readSubAgentRuns, writeSubAgentRuns } from "@/lib/sub-agent-persistence";

describe("sub-agent persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists completed sub-agent runs to the conversation sub-agent file", async () => {
    const runs: SubAgentRun[] = [
      {
        id: "sa-1",
        chatId: "sa-1",
        parentChatId: "chat-1",
        source: "sub-agent",
        name: "Research Recall",
        toolName: "retrieval_agent",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        text: "Done",
        chunksReceived: 4,
        toolCalls: [],
        error: null,
        parentMessageId: "transport",
        report: null,
      },
    ];

    await writeSubAgentRuns("folder-1", "chat-1", runs);

    expect(mockWriteAppFile).toHaveBeenCalledTimes(1);
    const written = mockWriteAppFile.mock.calls[0][0] as {
      subfolder: string;
      filename: string;
      content: string;
      emitChange?: boolean;
    };
    expect(written.subfolder).toBe("search-results/folder-1/chats");
    expect(written.filename).toBe("chat-1.subagents.json");
    expect(written.emitChange).toBe(false);
    expect(JSON.parse(written.content)).toEqual(runs);
  });

  it("does not reload persisted main-agent tool-call runs", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "tool-run-1",
          chatId: "tool-run-1",
          parentChatId: "chat-1",
          name: "Brave Search",
          toolName: "brave_search",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          text: "",
          toolCalls: [{ toolName: "brave_search", args: {}, status: "complete" }],
          error: null,
          parentMessageId: "msg-1",
        },
      ]),
    );

    await expect(readSubAgentRuns("folder-1", "chat-1")).resolves.toEqual([]);
  });

  it("reloads old complete/error statuses as completed/failed", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-complete",
          name: "Old Complete",
          toolName: "name_folder",
          status: "complete",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          text: "old-folder",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
        },
        {
          id: "sa-error",
          name: "Old Error",
          toolName: "retrieval_agent",
          status: "error",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          text: "",
          toolCalls: [{ toolName: "read_file", args: {}, status: "error" }],
          error: "failed",
          parentMessageId: "transport",
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toMatchObject([
      { id: "sa-complete", chatId: "sa-complete", parentChatId: "chat-1", status: "completed" },
      { id: "sa-error", chatId: "sa-error", parentChatId: "chat-1", status: "failed" },
    ]);
  });

  it("preserves streaming status from persisted runs", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-streaming",
          name: "Folder Naming",
          toolName: "name_folder",
          status: "streaming",
          startedAt: "2026-01-01T00:00:00.000Z",
          text: "best-coffee",
          chunksReceived: 3,
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toMatchObject([
      { id: "sa-streaming", status: "streaming", chunksReceived: 3 },
    ]);
  });

  it("defaults chunksReceived to 0 when missing from persisted data", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-old",
          name: "Memory Extraction",
          toolName: "memory_agent",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          text: "[]",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs[0].chunksReceived).toBe(0);
  });

  it("rejects run with invalid report status", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-1",
          name: "Memory Extraction",
          toolName: "memory_agent",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          text: "[]",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
          report: {
            name: "Memory Extraction",
            status: "garbage_status",
            startedAt: "2026-01-01T00:00:00.000Z",
            attempts: [],
          },
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toHaveLength(1);
    expect(runs[0].report).toBeNull();
  });

  it("strips invalid failureCategory from report", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-1",
          name: "Folder Naming",
          toolName: "name_folder",
          status: "failed",
          startedAt: "2026-01-01T00:00:00.000Z",
          text: "",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
          report: {
            name: "Folder Naming",
            status: "failed",
            failureCategory: "nonexistent_category",
            startedAt: "2026-01-01T00:00:00.000Z",
            attempts: [],
          },
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toHaveLength(1);
    expect(runs[0].report).not.toBeNull();
    expect(runs[0].report!.failureCategory).toBeUndefined();
  });

  it("preserves valid failureCategory in report", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-1",
          name: "Folder Naming",
          toolName: "name_folder",
          status: "failed",
          startedAt: "2026-01-01T00:00:00.000Z",
          text: "",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
          report: {
            name: "Folder Naming",
            status: "failed",
            failureCategory: "model_error",
            startedAt: "2026-01-01T00:00:00.000Z",
            attempts: [],
          },
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toHaveLength(1);
    expect(runs[0].report!.failureCategory).toBe("model_error");
  });

  it("preserves cancelled status from persisted runs", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-cancel",
          name: "Memory Extraction",
          toolName: "memory_agent",
          status: "cancelled",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          text: "Partial",
          chunksReceived: 2,
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
        },
      ]),
    );

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("cancelled");
  });

  it("logs diagnostic when persistence file contains corrupted JSON", async () => {
    mockReadAppFile.mockResolvedValue("{ corrupted json !!!");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse sub-agent runs file"),
    );

    consoleSpy.mockRestore();
  });

  it("logs diagnostic when persistence file is valid JSON but not an array", async () => {
    mockReadAppFile.mockResolvedValue(JSON.stringify({ not: "an array" }));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("not an array"),
    );

    consoleSpy.mockRestore();
  });

  it("logs diagnostic count when malformed runs are dropped during normalization", async () => {
    mockReadAppFile.mockResolvedValue(
      JSON.stringify([
        {
          id: "sa-valid",
          name: "Memory Extraction",
          toolName: "memory_agent",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          text: "",
          toolCalls: [],
          error: null,
          parentMessageId: "transport",
        },
        { corrupted: true },
        { missing: "everything" },
      ]),
    );
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const runs = await readSubAgentRuns("folder-1", "chat-1");

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("sa-valid");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropped 2 malformed sub-agent run(s)"),
    );

    consoleSpy.mockRestore();
  });
});
