import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import { SkillsProvider } from "@/hooks/use-skills";
import { setupMenu } from "@/lib/tauri-bridge";
import { subscribeResearchLibraryChanged } from "@/lib/research-library-events";
import {
  getChatModelOptions,
  getDefaultChatModelId,
} from "@/lib/chat-provider-settings";
import { type ChatModelConfig, type ChatProvider, createChatLanguageModel } from "@/lib/chat-providers";
import { SettingsPanel } from "@/components/settings-panel";
import { ToolsPanel } from "@/components/tools-panel";
import { PromptTemplatesSection } from "@/components/prompt-templates-section";
import { SkillsSection } from "@/components/skills-section";

import { TabPanel } from "@/components/tab-panel";
import { AppUpdateButton } from "@/components/app-update-button";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { ResearchSidebar } from "@/components/research-sidebar";
import { SubAgentProvider } from "@/lib/sub-agent-store";
import { SubAgentSidebar } from "@/components/sub-agent-sidebar";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";
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
import { searchFoldersWithLLMSafe } from "@/lib/folder-search";

const LazyChat = lazy(() =>
  import("@/components/chat").then((m) => ({ default: m.Chat })),
);

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

export interface ChatSessionRecord {
  sessionId: string;
  runtimeChatId: string;
  researchChatId: string;
  researchFolder: string | null;
  initialMessages: UIMessage[];
  isRunning: boolean;
  needsAttention: boolean;
}

interface ChatSessionState {
  sessions: ChatSessionRecord[];
  activeSessionId: string;
}

interface CreateChatSessionInput {
  researchChatId: string;
  researchFolder: string | null;
  initialMessages?: UIMessage[];
}

export function createChatSessionRecord({
  researchChatId,
  researchFolder,
  initialMessages = [],
}: CreateChatSessionInput): ChatSessionRecord {
  return {
    sessionId: createChatSessionId("session"),
    runtimeChatId: createChatSessionId("chat"),
    researchChatId,
    researchFolder,
    initialMessages,
    isRunning: false,
    needsAttention: false,
  };
}

export function activateChatSession(
  current: ChatSessionState,
  input: CreateChatSessionInput & { forceNew?: boolean },
): ChatSessionState {
  const existing = input.forceNew
    ? undefined
    : current.sessions.find(
        (session) =>
          session.researchFolder === input.researchFolder &&
          session.researchChatId === input.researchChatId,
      );

  if (existing) {
    if (!existing.isRunning && !existing.needsAttention) {
      const session = createChatSessionRecord(input);
      return {
        sessions: current.sessions
          .filter(
            (currentSession) =>
              currentSession.sessionId !== existing.sessionId,
          )
          .concat(session),
        activeSessionId: session.sessionId,
      };
    }

    return { ...current, activeSessionId: existing.sessionId };
  }

  const session = createChatSessionRecord(input);
  return {
    sessions: [...current.sessions, session],
    activeSessionId: session.sessionId,
  };
}

export function updateChatSessionResearchFolder(
  sessions: ChatSessionRecord[],
  sessionId: string,
  folderName: string,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? {
          ...session,
          researchFolder: folderName,
        }
      : session,
  );
}

export function updateChatSessionRunState(
  sessions: ChatSessionRecord[],
  sessionId: string,
  isRunning: boolean,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, isRunning }
      : session,
  );
}

export function updateChatSessionAttentionState(
  sessions: ChatSessionRecord[],
  sessionId: string,
  needsAttention: boolean,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, needsAttention }
      : session,
  );
}

export function getRunningResearchFolders(sessions: ChatSessionRecord[]) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => session.isRunning && session.researchFolder)
        .map((session) => session.researchFolder as string),
    ),
  );
}

export function getRunningResearchChatIds(sessions: ChatSessionRecord[]) {
  return sessions
    .filter((session) => session.isRunning)
    .map((session) => session.researchChatId);
}

export function getAttentionRequiredResearchFolders(
  sessions: ChatSessionRecord[],
) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => session.needsAttention && session.researchFolder)
        .map((session) => session.researchFolder as string),
    ),
  );
}

export function getAttentionRequiredResearchChatIds(
  sessions: ChatSessionRecord[],
) {
  return sessions
    .filter((session) => session.needsAttention)
    .map((session) => session.researchChatId);
}

export function hasRunningResearchFolder(
  sessions: ChatSessionRecord[],
  folderName: string,
) {
  return sessions.some(
    (session) => session.isRunning && session.researchFolder === folderName,
  );
}

function AppInner() {
  useSubAgentRenderCounter("AppInner");

  const { settings, loading, error: settingsError, updateSetting } = useSettings();
  const { tabs, activeTabId, switchToTab, closeTab } = useBrowserTabs();
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
  const [selectedModelId, setSelectedModelId] = useState("");
  const [subAgentSidebarOpen, setSubAgentSidebarOpen] = useState(false);
  const closeSubAgentSidebar = useCallback(() => {
    setSubAgentSidebarOpen(false);
  }, []);
  const handleToggleSubAgentSidebar = useCallback(() => {
    if (activeTabId !== "main") {
      switchToTab("main");
    }
    if (!activeResearchChatId) return;
    setSubAgentSidebarOpen((prev) => !prev);
  }, [activeTabId, activeResearchChatId, switchToTab]);
  const chatModelOptions = useMemo(
    () => getChatModelOptions(settings),
    [settings],
  );
  const defaultChatModelId = useMemo(
    () => getDefaultChatModelId(settings, chatModelOptions),
    [settings, chatModelOptions],
  );

  const activateSession = useCallback(
    (input: CreateChatSessionInput & { forceNew?: boolean }) => {
      setChatSessionState((current) => activateChatSession(current, input));
    },
    [],
  );

  const handleNewChat = useCallback(() => {
    activateSession({
      researchChatId: createResearchChatId(),
      researchFolder: null,
      forceNew: true,
    });
    setResearchChats([]);
    setResearchChatsStatus("idle");
    switchToTab("main");
  }, [activateSession, switchToTab]);

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

  const refreshResearchChats = useCallback(async (folderName: string) => {
    try {
      setResearchChats(await listResearchChats(folderName));
      if (researchChatsStatusRef.current === "idle") {
        setResearchChatsStatus("ready");
      }
    } catch (error) {
      console.error("[App] Failed to refresh research chats:", error);
      if (researchChatsStatusRef.current !== "ready") {
        setResearchChats([]);
        setResearchChatsStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    setupMenu(
      () => switchToTab("settings"),
      handleNewChat,
    );
  }, [switchToTab, handleNewChat]);

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

  useEffect(() => {
    const enabledModels = chatModelOptions.filter((option) => !option.disabled);
    if (enabledModels.length === 0) {
      if (selectedModelId) setSelectedModelId("");
      return;
    }

    if (!enabledModels.some((option) => option.id === selectedModelId)) {
      setSelectedModelId(defaultChatModelId);
    }
  }, [chatModelOptions, defaultChatModelId, selectedModelId]);

  const updateDefaultChatProvider = useCallback(
    (provider: ChatProvider) => {
      if (provider !== settings.chat_provider) {
        void updateSetting("chat_provider", provider);
      }
    },
    [settings.chat_provider, updateSetting],
  );

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

  useDesktopNotifications({
    sessions: chatSessions,
    activeSessionId,
    activateSession,
    switchToTab,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSelectResearchFolderRef = useRef<(folderName: string) => void>(null!);

  // Ctrl+Tab cycles through the "Previous Searches" folder list in the research sidebar.
  // Ctrl+Shift+Tab cycles backward.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !e.ctrlKey) return;

      if (researchFolders.length < 2) return;

      e.preventDefault();

      const currentIndex = researchFolders.findIndex(f => f.name === activeResearchFolder);
      let nextIndex: number;

      if (currentIndex === -1) {
        nextIndex = e.shiftKey ? researchFolders.length - 1 : 0;
      } else if (e.shiftKey) {
        nextIndex = currentIndex === 0 ? researchFolders.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex === researchFolders.length - 1 ? 0 : currentIndex + 1;
      }

      const nextFolder = researchFolders[nextIndex];
      if (nextFolder) {
        handleSelectResearchFolderRef.current(nextFolder.name);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [researchFolders, activeResearchFolder]);

  // Memoized: Chat's effectiveSearchKeys useMemo depends on this reference.
  // An unmemoized inline object would defeat that memo and re-run the spread
  // on every AppInner render (which happens on folder/attention transitions).
  const searchKeys = useMemo(
    () => ({
      braveApiKey: settings.brave_api_key || null,
      exaApiKey: settings.exa_api_key || null,
      serperApiKey: settings.serper_api_key || null,
      tavilyApiKey: settings.tavily_api_key || null,
      scrapeDoApiKey: settings.scrape_do_api_key || null,
      searxngBaseUrl: settings.searxng_url || null,
      currency: settings.currency,
      chromeDevToolsMcpEnabled: settings.chrome_devtools_mcp_enabled,
      chromeDevToolsMcpConnectionMode: settings.chrome_devtools_mcp_connection_mode,
      chromeDevtoolsMcpBrowserUrl: settings.chrome_devtools_mcp_browser_url || null,
      chromeDevtoolsMcpNodePath: settings.chrome_devtools_mcp_node_path || null,
      webExtractionBackend: settings.web_extraction_backend,
    }),
    [
      settings.brave_api_key,
      settings.exa_api_key,
      settings.serper_api_key,
      settings.tavily_api_key,
      settings.scrape_do_api_key,
      settings.searxng_url,
      settings.currency,
      settings.chrome_devtools_mcp_enabled,
      settings.chrome_devtools_mcp_connection_mode,
      settings.chrome_devtools_mcp_browser_url,
      settings.chrome_devtools_mcp_node_path,
      settings.web_extraction_backend,
    ],
  );
  const effectiveSelectedModelId = selectedModelId || defaultChatModelId;

  const getSelectedToolChatModel = (): ChatModelConfig | null => {
    const selected = chatModelOptions.find(
      (option) => option.id === effectiveSelectedModelId && !option.disabled,
    );
    if (!selected) return null;

    return {
      provider: selected.provider,
      apiKey: selected.apiKey,
      model: selected.model,
      baseURL: selected.baseURL,
    };
  };

  const chatModelOptionsRef = useRef(chatModelOptions);
  chatModelOptionsRef.current = chatModelOptions;

  // useCallback + refs so the handler identity is stable across AppInner
  // re-renders. Without this, Chat's useEffect at chat.tsx:150 re-fires on
  // every AppInner render because its `onSelectedModelIdChange` dep changes.
  const handleSelectedModelChange = useCallback((modelId: string) => {
    const selected = chatModelOptionsRef.current.find(
      (option) => option.id === modelId && !option.disabled,
    );
    if (!selected) return;

    setSelectedModelId(modelId);
    updateDefaultChatProvider(selected.provider);
  }, [updateDefaultChatProvider]);

  const handleSearchFolders = useCallback(
    async (query: string, abortSignal?: AbortSignal): Promise<string[]> => {
      const modelConfig = getSelectedToolChatModel();
      if (!modelConfig) return [];
      const model = createChatLanguageModel(modelConfig);
      return searchFoldersWithLLMSafe(
        query,
        researchFolders.map((f) => f.name),
        model,
        abortSignal,
      );
    },
    [researchFolders, effectiveSelectedModelId, chatModelOptions],
  );

  // Tracks the most recently requested folder selection so that out-of-order
  // async resolutions don't clobber the user's latest click. Without this,
  // clicking folder A then folder B in quick succession could leave the app
  // showing A if A's listResearchChats promise resolved slower than B's.
  const latestFolderSelectionRef = useRef<string | null>(null);

  const handleSelectResearchFolder = async (folderName: string) => {
    latestFolderSelectionRef.current = folderName;
    const isStale = () => latestFolderSelectionRef.current !== folderName;

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
    switchToTab("main");
    try {
      const messages = await readResearchChatMessages(folderName, chatId);
      activateSession({
        researchChatId: chatId,
        researchFolder: folderName,
        initialMessages: messages,
      });
    } catch (error) {
      console.error("[App] Failed to open research chat:", error);
      activateSession({
        researchChatId: chatId,
        researchFolder: folderName,
      });
    }
  };

  const handleNewResearchChat = (folderName: string) => {
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
      void refreshResearchChats(renamed.name);
    }

    void refreshResearchFolders();
  };

  const handleDeleteResearchFolder = async (folderName: string) => {
    if (hasRunningResearchFolder(chatSessionsRef.current, folderName)) {
      throw new Error("Stop the running research before deleting this search.");
    }

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

      if (sessions.some((session) => session.sessionId === current.activeSessionId)) {
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

  // Memoized: these five derivations all read from `chatSessions` and were
  // previously recomputed on every AppInner render (which fires on settings
  // changes, folder mutations, run-state transitions). Wrapping in useMemo
  // means they only recompute when chatSessions or activeSessionId change.
  // This keeps prop references stable for downstream consumers
  // (ResearchSidebar, TabPanel) and avoids wasted work.
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

  if (loading) return null;

  if (settingsError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", gap: "0.5rem" }}>
        <p style={{ fontSize: "1.125rem", fontWeight: 500 }}>Failed to load settings</p>
        <p style={{ fontSize: "0.875rem", opacity: 0.6 }}>{settingsError.message}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>Retry</button>
      </div>
    );
  }

  return (
    <TabPanel
      chatPanel={
        <div className="md-flex-row">
          <ResearchSidebar
            folders={researchFolders}
            activeFolderName={activeResearchFolder}
            chats={researchChats}
            activeChatId={activeResearchChatId}
            searchFolders={handleSearchFolders}
            status={researchFoldersStatus}
            chatsStatus={researchChatsStatus}
            runningFolderNames={runningFolderNames}
            runningChatIds={runningChatIds}
            attentionFolderNames={attentionFolderNames}
            attentionChatIds={attentionChatIds}
            onNewChat={handleNewChat}
            onSelectFolder={(folderName) => {
              void handleSelectResearchFolder(folderName);
            }}
            onNewResearchChat={handleNewResearchChat}
            onSelectChat={(folderName, chatId) => {
              void handleSelectResearchChat(folderName, chatId);
            }}
            onRenameFolder={handleRenameResearchFolder}
            onDeleteFolder={handleDeleteResearchFolder}
          />
          <div className="md-flex-fill" style={{ display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {mountedChatSessions.map((session) => (
                <div
                  key={session.sessionId}
                  style={{ height: "100%" }}
                  hidden={session.sessionId !== activeSessionId}
                >
                  <Suspense fallback={<div style={{ height: "100%" }} />}>
                    <LazyChat
                      sessionId={session.sessionId}
                      runtimeChatId={session.runtimeChatId}
                      researchChatId={session.researchChatId}
                      visible={session.sessionId === activeSessionId}
                      modelOptions={chatModelOptions}
                      defaultModelId={defaultChatModelId}
                      researchApiKey={settings.openrouter_api_key}
                      researchFolder={session.researchFolder}
                      selectedModelId={effectiveSelectedModelId}
                      initialMessages={session.initialMessages}
                      onResearchFolderChange={handleResearchFolderChange}
                      onRunStateChange={handleRunStateChange}
                      onAttentionStateChange={handleAttentionStateChange}
                      onSelectedModelIdChange={handleSelectedModelChange}
                      onConfigure={() => switchToTab("settings")}
                      searchKeys={searchKeys}
                      currency={settings.currency}
                      onResearchChatSaved={(folderName) => {
                        if (folderName === activeResearchFolderRef.current) {
                          void refreshResearchChats(folderName);
                        }
                      }}
                    />
                  </Suspense>
                </div>
              ))}
            </div>
            {subAgentSidebarOpen && activeResearchChatId && (
              <SubAgentSidebar
                chatId={activeResearchChatId}
                onClose={closeSubAgentSidebar}
              />
            )}
          </div>
        </div>
      }
      settingsPanel={<SettingsPanel />}
      promptsPanel={<PromptTemplatesSection />}
      skillsPanel={<SkillsSection />}
      toolsPanel={
        <ToolsPanel
          config={{
            researchFolder: activeResearchFolder,
            getChatModel: getSelectedToolChatModel,
            ...searchKeys,
          }}
        />
      }
      tabs={tabs}
      activeTabId={activeTabId}
      subAgentSidebarOpen={subAgentSidebarOpen}
      onToggleSubAgentSidebar={handleToggleSubAgentSidebar}
      toolbarEnd={<AppUpdateButton />}
      onSwitchTab={switchToTab}
      onCloseTab={closeTab}
    />
  );
}

function createChatSessionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeResearchFoldersWithCurrent(
  folders: ResearchFolder[],
  currentFolders: ResearchFolder[],
) {
  return folders
    .map((folder) => {
      const currentFolder = currentFolders.find(
        (candidate) => candidate.name === folder.name,
      );
      const updatedAt = newestTimestamp(
        folder.updatedAt,
        currentFolder?.updatedAt,
      );

      if (updatedAt !== folder.updatedAt) {
        return { ...folder, updatedAt };
      }

      return folder;
    })
    .sort(compareResearchFolders);
}

function upsertRecentResearchFolder(
  folders: ResearchFolder[],
  folderName: string,
) {
  const updatedAt = new Date().toISOString();
  const exists = folders.some((folder) => folder.name === folderName);
  const nextFolders = exists
    ? folders.map((folder) =>
        folder.name === folderName ? { ...folder, updatedAt } : folder,
      )
    : [...folders, { name: folderName, updatedAt }];

  return nextFolders.sort(compareResearchFolders);
}

function newestTimestamp(
  left?: string | null,
  right?: string | null,
) {
  return sortableTimestamp(right) > sortableTimestamp(left) ? right : left;
}

function sortableTimestamp(value?: string | null) {
  if (!value) return 0;

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function App() {
  return (
    <SettingsProvider>
      <PromptTemplatesProvider>
        <SkillsProvider>
          <SubAgentProvider>
            <AppInner />
          </SubAgentProvider>
        </SkillsProvider>
      </PromptTemplatesProvider>
    </SettingsProvider>
  );
}

export default App;
