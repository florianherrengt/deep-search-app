// @vitest-environment jsdom
import type { UIMessage } from "ai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResearchChatSummary,
  ResearchFolder,
} from "@/lib/research-history";

const workspaceMocks = vi.hoisted(() => ({
  chatIdCounter: 0,
  deleteResearchFolder: vi.fn<(folderName: string) => Promise<void>>(),
  libraryChanged: null as ((event: { folderName: string }) => void) | null,
  listResearchChats: vi.fn<
    (folderName: string) => Promise<ResearchChatSummary[]>
  >(),
  listResearchFolders: vi.fn<() => Promise<ResearchFolder[]>>(),
  readResearchChatMessages: vi.fn<
    (folderName: string, chatId: string) => Promise<UIMessage[]>
  >(),
  renameResearchFolder: vi.fn<
    (oldFolderName: string, newFolderName: string) => Promise<ResearchFolder>
  >(),
  onResearchChatSaved: null as
    | ((folderName: string, chatId: string) => void)
    | null,
}));

vi.mock("@/lib/chat-providers", () => ({
  createChatLanguageModel: vi.fn(),
}));

vi.mock("@/lib/folder-search", () => ({
  searchFoldersWithLLMSafe: vi.fn(async () => []),
}));

vi.mock("@/lib/research-history", () => ({
  compareResearchFolders: () => 0,
  createResearchChatId: () => {
    workspaceMocks.chatIdCounter += 1;
    return `generated-chat-${workspaceMocks.chatIdCounter}`;
  },
  deleteResearchFolder: workspaceMocks.deleteResearchFolder,
  listResearchChats: workspaceMocks.listResearchChats,
  listResearchFolders: workspaceMocks.listResearchFolders,
  readResearchChatMessages: workspaceMocks.readResearchChatMessages,
  renameResearchFolder: workspaceMocks.renameResearchFolder,
}));

vi.mock("@/lib/research-library-events", () => ({
  subscribeResearchLibraryChanged: vi.fn(
    (listener: (event: { folderName: string }) => void) => {
      workspaceMocks.libraryChanged = listener;
      return () => {
        workspaceMocks.libraryChanged = null;
      };
    },
  ),
}));

vi.mock("@/lib/mcp/deep-search-app-bridge", () => ({
  startDeepSearchMcpBridge: vi.fn(async () => () => undefined),
}));

vi.mock("@/lib/mcp/deep-search-session-manager", () => ({
  DeepSearchSessionManager: class {
    setConfig(config: {
      onResearchChatSaved?: (folderName: string, chatId: string) => void;
    }) {
      workspaceMocks.onResearchChatSaved = config.onResearchChatSaved ?? null;
    }
  },
}));

import { useResearchWorkspace } from "@/hooks/use-research-workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function chatSummary(id: string): ResearchChatSummary {
  return {
    id,
    title: id,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    messageCount: 1,
  };
}

function messagesFor(chatId: string): UIMessage[] {
  return [
    {
      id: `message-${chatId}`,
      role: "assistant",
      parts: [{ type: "text", text: chatId }],
    },
  ];
}

function renderWorkspace() {
  return renderHook(() =>
    useResearchWorkspace({
      bridgeEnabled: false,
      getChatModel: () => null,
      processSubAgentEvent: vi.fn(),
      searchKeys: {},
      switchToTab: vi.fn(),
    }),
  );
}

describe("useResearchWorkspace navigation", () => {
  beforeEach(() => {
    workspaceMocks.chatIdCounter = 0;
    workspaceMocks.deleteResearchFolder.mockReset().mockResolvedValue(undefined);
    workspaceMocks.libraryChanged = null;
    workspaceMocks.onResearchChatSaved = null;
    workspaceMocks.listResearchChats.mockReset().mockResolvedValue([]);
    workspaceMocks.listResearchFolders.mockReset().mockResolvedValue([]);
    workspaceMocks.readResearchChatMessages
      .mockReset()
      .mockImplementation(async (_folderName, chatId) => messagesFor(chatId));
    workspaceMocks.renameResearchFolder
      .mockReset()
      .mockImplementation(async (_oldFolderName, newFolderName) => ({
        name: newFolderName,
      }));
  });

  afterEach(() => {
    cleanup();
  });

  it("ignores the first folder result in an A to B to A selection race", async () => {
    const firstFolderA = deferred<ResearchChatSummary[]>();
    let folderACalls = 0;
    workspaceMocks.listResearchChats.mockImplementation(async (folderName) => {
      if (folderName === "folder-a") {
        folderACalls += 1;
        if (folderACalls === 1) return firstFolderA.promise;
        return [chatSummary("chat-a-latest")];
      }
      return [chatSummary("chat-b")];
    });
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchFolder("folder-a");
    });

    await act(async () => {
      const middleOpen = result.current.handleSelectResearchFolder("folder-b");
      const latestOpen = result.current.handleSelectResearchFolder("folder-a");
      await Promise.all([middleOpen, latestOpen]);
    });
    expect(result.current.activeResearchChatId).toBe("chat-a-latest");

    await act(async () => {
      firstFolderA.resolve([chatSummary("chat-a-stale")]);
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("folder-a");
    expect(result.current.activeResearchChatId).toBe("chat-a-latest");
    expect(result.current.researchChats).toEqual([
      chatSummary("chat-a-latest"),
    ]);
  });

  it("ignores an older chat read that resolves after the latest chat", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.readResearchChatMessages.mockImplementation(
      async (_folderName, chatId) =>
        chatId === "chat-stale" ? staleMessages.promise : messagesFor(chatId),
    );
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat(
        "folder",
        "chat-stale",
      );
    });
    await act(async () => {
      await result.current.handleSelectResearchChat("folder", "chat-latest");
    });
    expect(result.current.activeResearchChatId).toBe("chat-latest");

    await act(async () => {
      staleMessages.resolve(messagesFor("chat-stale"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("folder");
    expect(result.current.activeResearchChatId).toBe("chat-latest");
  });

  it("lets a chat selection invalidate a pending folder selection", async () => {
    const staleFolderChats = deferred<ResearchChatSummary[]>();
    workspaceMocks.listResearchChats.mockReturnValue(staleFolderChats.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchFolder("stale-folder");
    });
    await act(async () => {
      await result.current.handleSelectResearchChat(
        "latest-folder",
        "latest-chat",
      );
    });

    await act(async () => {
      staleFolderChats.resolve([chatSummary("stale-chat")]);
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("latest-folder");
    expect(result.current.activeResearchChatId).toBe("latest-chat");
  });

  it("lets an external session activation invalidate a pending folder selection", async () => {
    const staleFolderChats = deferred<ResearchChatSummary[]>();
    workspaceMocks.listResearchChats.mockReturnValue(staleFolderChats.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchFolder("stale-folder");
      result.current.activateSession({
        researchChatId: "notification-chat",
        researchFolder: "notification-folder",
      });
    });

    await act(async () => {
      staleFolderChats.resolve([chatSummary("stale-chat")]);
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("notification-folder");
    expect(result.current.activeResearchChatId).toBe("notification-chat");
  });

  it("lets an MCP chat open invalidate a pending manual chat selection", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.listResearchChats.mockResolvedValue([
      chatSummary("mcp-chat"),
    ]);
    workspaceMocks.readResearchChatMessages.mockImplementation(
      async (_folderName, chatId) =>
        chatId === "manual-chat" ? staleMessages.promise : messagesFor(chatId),
    );
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat(
        "manual-folder",
        "manual-chat",
      );
      workspaceMocks.onResearchChatSaved?.("mcp-folder", "mcp-chat");
    });
    await waitFor(() => {
      expect(result.current.activeResearchChatId).toBe("mcp-chat");
    });

    await act(async () => {
      staleMessages.resolve(messagesFor("manual-chat"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("mcp-folder");
    expect(result.current.activeResearchChatId).toBe("mcp-chat");
  });

  it("keeps a new folder chat active when a pending chat read finishes", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.readResearchChatMessages.mockReturnValue(staleMessages.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat(
        "folder",
        "persisted-chat",
      );
      result.current.handleNewResearchChat("folder");
    });
    expect(result.current.activeResearchChatId).toBe("generated-chat-2");

    await act(async () => {
      staleMessages.resolve(messagesFor("persisted-chat"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBe("folder");
    expect(result.current.activeResearchChatId).toBe("generated-chat-2");
  });

  it("keeps a new unfiled chat active when a pending chat read finishes", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.readResearchChatMessages.mockReturnValue(staleMessages.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat(
        "folder",
        "persisted-chat",
      );
      result.current.handleNewChat();
    });
    expect(result.current.activeResearchChatId).toBe("generated-chat-2");

    await act(async () => {
      staleMessages.resolve(messagesFor("persisted-chat"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBeNull();
    expect(result.current.activeResearchChatId).toBe("generated-chat-2");
  });

  it("ignores an old-folder background refresh after navigating", async () => {
    const staleRefresh = deferred<ResearchChatSummary[]>();
    workspaceMocks.listResearchChats.mockImplementation(async (folderName) => {
      if (folderName === "folder-a") return [chatSummary("chat-a")];
      return [chatSummary("chat-b")];
    });
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    await act(async () => {
      await result.current.handleSelectResearchFolder("folder-a");
    });
    workspaceMocks.listResearchChats.mockImplementation(async (folderName) =>
      folderName === "folder-a" ? staleRefresh.promise : [chatSummary("chat-b")],
    );

    act(() => {
      workspaceMocks.libraryChanged?.({ folderName: "folder-a" });
    });
    await act(async () => {
      await result.current.handleSelectResearchFolder("folder-b");
    });
    await act(async () => {
      staleRefresh.resolve([chatSummary("chat-a-stale")]);
      await Promise.resolve();
    });

    expect(result.current.activeResearchFolder).toBe("folder-b");
    expect(result.current.researchChats).toEqual([chatSummary("chat-b")]);
  });

  it("ignores an old-folder refresh started during a newer navigation", async () => {
    workspaceMocks.listResearchChats.mockImplementation(async (folderName) =>
      folderName === "folder-a"
        ? [chatSummary("chat-a")]
        : [chatSummary("chat-b")],
    );
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    await act(async () => {
      await result.current.handleSelectResearchFolder("folder-a");
    });

    const folderBNavigation = deferred<ResearchChatSummary[]>();
    const staleFolderARefresh = deferred<ResearchChatSummary[]>();
    workspaceMocks.listResearchChats.mockImplementation(async (folderName) =>
      folderName === "folder-a"
        ? staleFolderARefresh.promise
        : folderBNavigation.promise,
    );

    let openFolderB!: Promise<void>;
    act(() => {
      openFolderB = result.current.handleSelectResearchFolder("folder-b");
    });
    act(() => {
      workspaceMocks.libraryChanged?.({ folderName: "folder-a" });
    });

    await act(async () => {
      folderBNavigation.resolve([chatSummary("chat-b")]);
      await openFolderB;
    });
    expect(result.current.activeResearchFolder).toBe("folder-b");

    await act(async () => {
      staleFolderARefresh.resolve([chatSummary("chat-a-stale")]);
      await Promise.resolve();
    });

    expect(result.current.activeResearchFolder).toBe("folder-b");
    expect(result.current.researchChats).toEqual([chatSummary("chat-b")]);
  });

  it("does not reactivate a chat after its folder is deleted", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.readResearchChatMessages.mockReturnValue(staleMessages.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat("folder", "deleted-chat");
    });
    await act(async () => {
      await result.current.handleDeleteResearchFolder("folder");
    });
    await act(async () => {
      staleMessages.resolve(messagesFor("deleted-chat"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBeNull();
    expect(result.current.activeResearchChatId).toBe("generated-chat-1");
  });

  it("does not reactivate a chat under its old folder after rename", async () => {
    const staleMessages = deferred<UIMessage[]>();
    workspaceMocks.readResearchChatMessages.mockReturnValue(staleMessages.promise);
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.researchFoldersStatus).toBe("ready"));

    let staleOpen!: Promise<void>;
    act(() => {
      staleOpen = result.current.handleSelectResearchChat("old-folder", "stale-chat");
    });
    await act(async () => {
      await result.current.handleRenameResearchFolder("old-folder", "new-folder");
    });
    await act(async () => {
      staleMessages.resolve(messagesFor("stale-chat"));
      await staleOpen;
    });

    expect(result.current.activeResearchFolder).toBeNull();
    expect(result.current.activeResearchChatId).toBe("generated-chat-1");
  });
});
