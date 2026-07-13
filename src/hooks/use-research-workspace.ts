import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatModelConfig,
  createChatLanguageModel,
} from "@/lib/chat-providers";
import {
  activateChatSession as activateChatSessionState,
  createChatSessionRecord,
  getAttentionRequiredResearchChatIds,
  getAttentionRequiredResearchFolders,
  getRunningResearchChatIds,
  getRunningResearchFolders,
  hasRunningResearchFolder,
  updateChatSessionAttentionState,
  updateChatSessionResearchFolder,
  updateChatSessionRunState,
  type ChatSessionRecord,
  type ChatSessionState,
  type CreateChatSessionInput,
} from "@/lib/chat-sessions";
import { searchFoldersWithLLMSafe } from "@/lib/folder-search";
import { startDeepSearchMcpBridge } from "@/lib/mcp/deep-search-app-bridge";
import { DeepSearchSessionManager } from "@/lib/mcp/deep-search-session-manager";
import {
  compareResearchFolders,
  createResearchChatId,
  deleteResearchFolder,
  listResearchChats,
  listResearchFolders,
  readResearchChatMessages,
  renameResearchFolder,
  type ResearchChatSummary,
  type ResearchFolder,
} from "@/lib/research-history";
import { subscribeResearchLibraryChanged } from "@/lib/research-library-events";
import {
  mergeResearchFoldersWithCurrent,
  upsertRecentResearchFolder,
} from "@/lib/research-folder-list";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import type { SearchToolKeys } from "@/lib/transport";

interface UseResearchWorkspaceOptions {
  bridgeEnabled: boolean;
  getChatModel: () => ChatModelConfig | null;
  processSubAgentEvent: (chatId: string, event: SubAgentEvent) => void;
  searchKeys: SearchToolKeys;
  switchToTab: (tabId: string) => void;
}

export interface ResearchWorkspace {
  activeResearchChatId: string | null;
  activeResearchFolder: string | null;
  activeSessionId: string;
  activateSession: (input: CreateChatSessionInput & { forceNew?: boolean }) => void;
  attentionChatIds: string[];
  attentionFolderNames: string[];
  chatSessions: ChatSessionRecord[];
  handleAttentionStateChange: (sessionId: string, needsAttention: boolean) => void;
  handleDeleteResearchFolder: (folderName: string) => Promise<void>;
  handleNewChat: () => void;
  handleNewResearchChat: (folderName: string) => void;
  handleRenameResearchFolder: (
    oldFolderName: string,
    newFolderName: string,
  ) => Promise<void>;
  handleResearchChatSaved: (folderName: string) => void;
  handleResearchFolderChange: (sessionId: string, folderName: string) => void;
  handleRunStateChange: (sessionId: string, isRunning: boolean) => void;
  handleSearchFolders: (query: string, abortSignal?: AbortSignal) => Promise<string[]>;
  handleSelectResearchChat: (folderName: string, chatId: string) => Promise<void>;
  handleSelectResearchFolder: (folderName: string) => Promise<void>;
  mountedChatSessions: ChatSessionRecord[];
  researchChats: ResearchChatSummary[];
  researchChatsStatus: "idle" | "loading" | "ready" | "error";
  researchFolders: ResearchFolder[];
  researchFoldersStatus: "loading" | "ready" | "error";
  runningChatIds: string[];
  runningFolderNames: string[];
}

export function useResearchWorkspace({
  bridgeEnabled,
  getChatModel,
  processSubAgentEvent,
  searchKeys,
  switchToTab,
}: UseResearchWorkspaceOptions): ResearchWorkspace {
  const [researchFolders, setResearchFolders] = useState<ResearchFolder[]>([]);
  const [researchFoldersStatus, setResearchFoldersStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [chatSessionState, setChatSessionState] = useState<ChatSessionState>(
    () => {
      const session = createChatSessionRecord({
        researchChatId: createResearchChatId(),
        researchFolder: null,
      });

      return {
        sessions: [session],
        activeSessionId: session.sessionId,
      };
    },
  );
  const chatSessions = chatSessionState.sessions;
  const activeSessionId = chatSessionState.activeSessionId;
  const activeSession =
    chatSessions.find((session) => session.sessionId === activeSessionId) ??
    chatSessions[0] ??
    null;
  const activeResearchFolder = activeSession?.researchFolder ?? null;
  const activeResearchChatId = activeSession?.researchChatId ?? null;
  const activeResearchFolderRef = useRef(activeResearchFolder);
  activeResearchFolderRef.current = activeResearchFolder;
  const chatSessionsRef = useRef(chatSessions);
  chatSessionsRef.current = chatSessions;

  const [researchChats, setResearchChats] = useState<ResearchChatSummary[]>([]);
  const [researchChatsStatus, setResearchChatsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const researchChatsStatusRef = useRef(researchChatsStatus);
  researchChatsStatusRef.current = researchChatsStatus;

  const getChatModelRef = useRef(getChatModel);
  getChatModelRef.current = getChatModel;
  const processSubAgentEventRef = useRef(processSubAgentEvent);
  processSubAgentEventRef.current = processSubAgentEvent;
  const searchKeysRef = useRef(searchKeys);
  searchKeysRef.current = searchKeys;

  const latestResearchNavigationRef = useRef<object | null>(null);
  const beginResearchNavigation = useCallback(() => {
    const request = {};
    latestResearchNavigationRef.current = request;
    return () => latestResearchNavigationRef.current !== request;
  }, []);
  const invalidateResearchNavigation = useCallback(() => {
    latestResearchNavigationRef.current = {};
  }, []);

  const activateSession = useCallback(
    (input: CreateChatSessionInput & { forceNew?: boolean }) => {
      activeResearchFolderRef.current = input.researchFolder;
      setChatSessionState((current) =>
        activateChatSessionState(current, input),
      );
    },
    [],
  );
  const activateExternalSession = useCallback(
    (input: CreateChatSessionInput & { forceNew?: boolean }) => {
      invalidateResearchNavigation();
      activateSession(input);
    },
    [activateSession, invalidateResearchNavigation],
  );

  const handleNewChat = useCallback(() => {
    invalidateResearchNavigation();
    activateSession({
      researchChatId: createResearchChatId(),
      researchFolder: null,
      forceNew: true,
    });
    setResearchChats([]);
    setResearchChatsStatus("idle");
    switchToTab("main");
  }, [activateSession, invalidateResearchNavigation, switchToTab]);

  const refreshResearchFolders = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (options.showLoading) {
        setResearchFoldersStatus("loading");
      }

      try {
        const folders = await listResearchFolders();
        setResearchFolders((currentFolders) =>
          mergeResearchFoldersWithCurrent(folders, currentFolders),
        );
        setResearchFoldersStatus("ready");
      } catch (error) {
        console.error("[App] Failed to refresh research folders:", error);
        setResearchFoldersStatus("error");
      }
    },
    [],
  );

  const latestResearchChatsRefreshRef = useRef<object | null>(null);
  const refreshResearchChats = useCallback(async (folderName: string) => {
    const request = {};
    latestResearchChatsRefreshRef.current = request;
    const navigation = latestResearchNavigationRef.current;
    const isStale = () =>
      latestResearchChatsRefreshRef.current !== request ||
      latestResearchNavigationRef.current !== navigation ||
      activeResearchFolderRef.current !== folderName;

    try {
      const chats = await listResearchChats(folderName);
      if (isStale()) return;
      setResearchChats(chats);
      if (researchChatsStatusRef.current === "idle") {
        setResearchChatsStatus("ready");
      }
    } catch (error) {
      if (isStale()) return;
      console.error("[App] Failed to refresh research chats:", error);
      if (researchChatsStatusRef.current !== "ready") {
        setResearchChats([]);
        setResearchChatsStatus("error");
      }
    }
  }, []);

  const openMcpResearchChat = useCallback(
    async (folderName: string, chatId: string) => {
      const isStale = beginResearchNavigation();

      setResearchFolders((folders) =>
        upsertRecentResearchFolder(folders, folderName),
      );
      setResearchChatsStatus("loading");
      switchToTab("main");

      try {
        const [chats, messages] = await Promise.all([
          listResearchChats(folderName),
          readResearchChatMessages(folderName, chatId),
        ]);
        if (isStale()) return;

        setResearchChats(chats);
        setResearchChatsStatus("ready");
        activateSession({
          researchChatId: chatId,
          researchFolder: folderName,
          initialMessages: messages,
        });
      } catch (error) {
        if (isStale()) return;

        console.error("[App] Failed to open MCP research chat:", error);
        setResearchChatsStatus("error");
        activateSession({
          researchChatId: chatId,
          researchFolder: folderName,
        });
      }
    },
    [activateSession, beginResearchNavigation, switchToTab],
  );

  useEffect(() => {
    void refreshResearchFolders({ showLoading: true });
  }, [refreshResearchFolders]);

  useEffect(() => {
    return subscribeResearchLibraryChanged(({ folderName }) => {
      setResearchFolders((folders) =>
        upsertRecentResearchFolder(folders, folderName),
      );
      void refreshResearchFolders();

      if (folderName === activeResearchFolderRef.current) {
        void refreshResearchChats(folderName);
      }
    });
  }, [refreshResearchChats, refreshResearchFolders]);

  const handleRunStateChange = useCallback(
    (sessionId: string, isRunning: boolean) => {
      setChatSessionState((current) => ({
        ...current,
        sessions: updateChatSessionRunState(
          current.sessions,
          sessionId,
          isRunning,
        ),
      }));
    },
    [],
  );

  const handleAttentionStateChange = useCallback(
    (sessionId: string, needsAttention: boolean) => {
      setChatSessionState((current) => ({
        ...current,
        sessions: updateChatSessionAttentionState(
          current.sessions,
          sessionId,
          needsAttention,
        ),
      }));
    },
    [],
  );

  const handleSelectResearchFolderRef = useRef<(folderName: string) => void>(
    null!,
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !e.ctrlKey) return;

      if (researchFolders.length < 2) return;

      e.preventDefault();

      const currentIndex = researchFolders.findIndex(
        (f) => f.name === activeResearchFolder,
      );
      let nextIndex: number;

      if (currentIndex === -1) {
        nextIndex = e.shiftKey ? researchFolders.length - 1 : 0;
      } else if (e.shiftKey) {
        nextIndex =
          currentIndex === 0 ? researchFolders.length - 1 : currentIndex - 1;
      } else {
        nextIndex =
          currentIndex === researchFolders.length - 1 ? 0 : currentIndex + 1;
      }

      const nextFolder = researchFolders[nextIndex];
      if (nextFolder) {
        handleSelectResearchFolderRef.current(nextFolder.name);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [researchFolders, activeResearchFolder]);

  const mcpSessionManagerRef = useRef<DeepSearchSessionManager | null>(null);
  if (!mcpSessionManagerRef.current) {
    mcpSessionManagerRef.current = new DeepSearchSessionManager({
      getChatModel: () => getChatModelRef.current(),
      getSearchKeys: () => searchKeysRef.current,
    });
  }
  mcpSessionManagerRef.current.setConfig({
    getChatModel: () => getChatModelRef.current(),
    getSearchKeys: () => searchKeysRef.current,
    onResearchFolderChange: (_sessionId, folderName) => {
      setResearchFolders((folders) =>
        upsertRecentResearchFolder(folders, folderName),
      );
      void refreshResearchFolders();
      if (folderName === activeResearchFolderRef.current) {
        void refreshResearchChats(folderName);
      }
    },
    onResearchChatSaved: (folderName, chatId) => {
      void openMcpResearchChat(folderName, chatId);
    },
    onSubAgentEvent: (chatId, event) => {
      processSubAgentEventRef.current(chatId, event);
    },
  });

  useEffect(() => {
    if (!bridgeEnabled) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void startDeepSearchMcpBridge((body) => {
      const manager = mcpSessionManagerRef.current;
      if (!manager) {
        throw new Error("Deep Search MCP session manager is not ready.");
      }
      return manager.handle(body);
    })
      .then((nextCleanup) => {
        if (cancelled) {
          nextCleanup();
          return;
        }
        cleanup = nextCleanup;
      })
      .catch((error) => {
        console.error("[mcp-bridge] Failed to start:", error);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [bridgeEnabled]);

  const handleSearchFolders = useCallback(
    async (query: string, abortSignal?: AbortSignal): Promise<string[]> => {
      const modelConfig = getChatModelRef.current();
      if (!modelConfig) return [];
      const model = createChatLanguageModel(modelConfig);
      return searchFoldersWithLLMSafe(
        query,
        researchFolders.map((f) => f.name),
        model,
        abortSignal,
      );
    },
    [researchFolders],
  );

  const handleSelectResearchFolder = async (folderName: string) => {
    const isStale = beginResearchNavigation();

    setResearchChatsStatus("loading");
    switchToTab("main");

    const waitingSession = chatSessionsRef.current.find(
      (session) =>
        session.researchFolder === folderName && session.needsAttention,
    );
    if (waitingSession) {
      activateSession({
        researchChatId: waitingSession.researchChatId,
        researchFolder: folderName,
      });
      try {
        const chats = await listResearchChats(folderName);
        if (isStale()) return;
        setResearchChats(chats);
        setResearchChatsStatus("ready");
      } catch (error) {
        if (isStale()) return;
        console.error("[App] Failed to list research chats:", error);
        setResearchChats([]);
        setResearchChatsStatus("error");
      }
      return;
    }

    try {
      const chats = await listResearchChats(folderName);
      if (isStale()) return;
      const selectedChatId = chats[0]?.id ?? createResearchChatId();
      const messages = chats[0]
        ? await readResearchChatMessages(folderName, selectedChatId)
        : [];

      if (isStale()) return;
      setResearchChats(chats);
      setResearchChatsStatus("ready");
      activateSession({
        researchChatId: selectedChatId,
        researchFolder: folderName,
        initialMessages: messages,
      });
    } catch (error) {
      if (isStale()) return;
      console.error("[App] Failed to open research folder:", error);
      const nextChatId = createResearchChatId();
      setResearchChats([]);
      setResearchChatsStatus("error");
      activateSession({
        researchChatId: nextChatId,
        researchFolder: folderName,
        forceNew: true,
      });
    }
  };

  handleSelectResearchFolderRef.current = handleSelectResearchFolder;

  const handleSelectResearchChat = async (
    folderName: string,
    chatId: string,
  ) => {
    const isStale = beginResearchNavigation();
    switchToTab("main");
    try {
      const messages = await readResearchChatMessages(folderName, chatId);
      if (isStale()) return;
      activateSession({
        researchChatId: chatId,
        researchFolder: folderName,
        initialMessages: messages,
      });
    } catch (error) {
      if (isStale()) return;
      console.error("[App] Failed to open research chat:", error);
      activateSession({
        researchChatId: chatId,
        researchFolder: folderName,
      });
    }
  };

  const handleNewResearchChat = (folderName: string) => {
    invalidateResearchNavigation();
    const nextChatId = createResearchChatId();

    activateSession({
      researchChatId: nextChatId,
      researchFolder: folderName,
      forceNew: true,
    });
    switchToTab("main");
  };

  const handleResearchFolderChange = (
    sessionId: string,
    folderName: string,
  ) => {
    setChatSessionState((current) => ({
      ...current,
      sessions: updateChatSessionResearchFolder(
        current.sessions,
        sessionId,
        folderName,
      ),
    }));
    setResearchFolders((folders) =>
      upsertRecentResearchFolder(folders, folderName),
    );
    void refreshResearchFolders();
    if (sessionId === chatSessionState.activeSessionId) {
      activeResearchFolderRef.current = folderName;
      void refreshResearchChats(folderName);
    }
  };

  const handleRenameResearchFolder = async (
    oldFolderName: string,
    newFolderName: string,
  ) => {
    if (hasRunningResearchFolder(chatSessionsRef.current, oldFolderName)) {
      throw new Error("Stop the running research before renaming this search.");
    }

    invalidateResearchNavigation();

    const renamed = await renameResearchFolder(oldFolderName, newFolderName);

    setResearchFolders((folders) =>
      folders
        .map((folder) =>
          folder.name === oldFolderName
            ? { ...renamed, updatedAt: folder.updatedAt ?? null }
            : folder,
        )
        .sort(compareResearchFolders),
    );
    setChatSessionState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.researchFolder === oldFolderName
          ? { ...session, researchFolder: renamed.name }
          : session,
      ),
    }));

    if (activeResearchFolder === oldFolderName) {
      activeResearchFolderRef.current = renamed.name;
      void refreshResearchChats(renamed.name);
    }

    void refreshResearchFolders();
  };

  const handleDeleteResearchFolder = async (folderName: string) => {
    if (hasRunningResearchFolder(chatSessionsRef.current, folderName)) {
      throw new Error("Stop the running research before deleting this search.");
    }

    invalidateResearchNavigation();

    await deleteResearchFolder(folderName);

    setResearchFolders((folders) =>
      folders.filter((folder) => folder.name !== folderName),
    );

    if (activeResearchFolder === folderName) {
      setResearchChats([]);
      setResearchChatsStatus("idle");
      activateSession({
        researchChatId: createResearchChatId(),
        researchFolder: null,
        forceNew: true,
      });
      switchToTab("main");
    }
    setChatSessionState((current) => {
      const sessions = current.sessions.filter(
        (session) => session.researchFolder !== folderName,
      );

      if (
        sessions.some(
          (session) => session.sessionId === current.activeSessionId,
        )
      ) {
        return { ...current, sessions };
      }

      const fallback = createChatSessionRecord({
        researchChatId: createResearchChatId(),
        researchFolder: null,
      });
      return {
        sessions: [...sessions, fallback],
        activeSessionId: fallback.sessionId,
      };
    });

    void refreshResearchFolders();
  };

  const handleResearchChatSaved = useCallback(
    (folderName: string) => {
      if (folderName === activeResearchFolderRef.current) {
        void refreshResearchChats(folderName);
      }
    },
    [refreshResearchChats],
  );

  const runningFolderNames = useMemo(
    () => getRunningResearchFolders(chatSessions),
    [chatSessions],
  );
  const runningChatIds = useMemo(
    () => getRunningResearchChatIds(chatSessions),
    [chatSessions],
  );
  const attentionFolderNames = useMemo(
    () => getAttentionRequiredResearchFolders(chatSessions),
    [chatSessions],
  );
  const attentionChatIds = useMemo(
    () => getAttentionRequiredResearchChatIds(chatSessions),
    [chatSessions],
  );
  const mountedChatSessions = useMemo(
    () =>
      chatSessions.filter(
        (session) =>
          session.sessionId === activeSessionId ||
          session.isRunning ||
          session.needsAttention,
      ),
    [chatSessions, activeSessionId],
  );

  return {
    activeResearchChatId,
    activeResearchFolder,
    activeSessionId,
    activateSession: activateExternalSession,
    attentionChatIds,
    attentionFolderNames,
    chatSessions,
    handleAttentionStateChange,
    handleDeleteResearchFolder,
    handleNewChat,
    handleNewResearchChat,
    handleRenameResearchFolder,
    handleResearchChatSaved,
    handleResearchFolderChange,
    handleRunStateChange,
    handleSearchFolders,
    handleSelectResearchChat,
    handleSelectResearchFolder,
    mountedChatSessions,
    researchChats,
    researchChatsStatus,
    researchFolders,
    researchFoldersStatus,
    runningChatIds,
    runningFolderNames,
  };
}
