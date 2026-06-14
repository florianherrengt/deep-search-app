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
import { type ChatModelConfig, type ChatProvider } from "@/lib/chat-providers";
import { SettingsPanel } from "@/components/settings-panel";
import { ToolsPanel } from "@/components/tools-panel";
import { PromptTemplatesSection } from "@/components/prompt-templates-section";
import { SkillsSection } from "@/components/skills-section";

import { TabPanel } from "@/components/tab-panel";
import { AppUpdateButton } from "@/components/app-update-button";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { ResearchSidebar } from "@/components/research-sidebar";
import { SubAgentProvider, useSubAgentRunsByChat, useSubAgentSelectedRunId } from "@/lib/sub-agent-store";
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
import { resolveEmbeddingConfig, resolveRerankerConfig } from "@/lib/settings-store";
import { reindexFolder } from "@/lib/research-search";

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
  const openSubAgentSidebar = useCallback(() => {
    setSubAgentSidebarOpen(true);
  }, []);
  const closeSubAgentSidebar = useCallback(() => {
    setSubAgentSidebarOpen(false);
  }, []);
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

  const embeddingConfig = resolveEmbeddingConfig(settings);
  const rerankerConfig = resolveRerankerConfig(settings);

  const searchKeys = {
    braveApiKey: settings.brave_api_key || null,
    exaApiKey: settings.exa_api_key || null,
    serperApiKey: settings.serper_api_key || null,
    tavilyApiKey: settings.tavily_api_key || null,
    searxngBaseUrl: settings.searxng_url || null,
    currency: settings.currency,
    chromeDevToolsMcpEnabled: settings.chrome_devtools_mcp_enabled,
  };
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

  const handleSelectedModelChange = (modelId: string) => {
    const selected = chatModelOptions.find(
      (option) => option.id === modelId && !option.disabled,
    );
    if (!selected) return;

    setSelectedModelId(modelId);
    updateDefaultChatProvider(selected.provider);
  };


  const handleSelectResearchFolder = async (folderName: string) => {
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
        setResearchChats(await listResearchChats(folderName));
        setResearchChatsStatus("ready");
      } catch (error) {
        console.error("[App] Failed to list research chats:", error);
        setResearchChats([]);
        setResearchChatsStatus("error");
      }
      return;
    }

    try {
      const chats = await listResearchChats(folderName);
      const selectedChatId = chats[0]?.id ?? createResearchChatId();
      const messages = chats[0]
        ? await readResearchChatMessages(folderName, selectedChatId)
        : [];

      setResearchChats(chats);
      setResearchChatsStatus("ready");
      activateSession({
        researchChatId: selectedChatId,
        researchFolder: folderName,
        initialMessages: messages,
      });
    } catch (error) {
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

  const handleReindexResearchFolder = async (folderName: string) => {
    await reindexFolder(embeddingConfig, folderName);
    void refreshResearchFolders();
  };

  const runningFolderNames = getRunningResearchFolders(chatSessions);
  const runningChatIds = getRunningResearchChatIds(chatSessions);
  const attentionFolderNames = getAttentionRequiredResearchFolders(chatSessions);
  const attentionChatIds = getAttentionRequiredResearchChatIds(chatSessions);
  const visibleChatSessions = chatSessions.filter(
    (session) =>
      session.sessionId === activeSessionId ||
      session.isRunning ||
      session.needsAttention,
  );

  return (
    <TabPanel
      chatPanel={
        <div className="md-flex-row">
          <ResearchSidebar
            folders={researchFolders}
            activeFolderName={activeResearchFolder}
            chats={researchChats}
            activeChatId={activeResearchChatId}
            embeddingConfig={embeddingConfig}
            rerankerConfig={rerankerConfig}
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
            onReindexFolder={handleReindexResearchFolder}
          />
          <div className="md-flex-fill" style={{ display: "flex" }}>
            <SubAgentSidebarAutoOpen
              chatId={activeResearchChatId}
              onOpen={openSubAgentSidebar}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {visibleChatSessions.map((session) => (
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
                      embeddingConfig={embeddingConfig}
                      rerankerConfig={rerankerConfig}
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
            embeddingConfig,
            rerankerConfig,
            getChatModel: getSelectedToolChatModel,
            ...searchKeys,
          }}
        />
      }
      tabs={tabs}
      activeTabId={activeTabId}
      toolbarEnd={<AppUpdateButton />}
      onSwitchTab={switchToTab}
      onCloseTab={closeTab}
    />
  );
}

function SubAgentSidebarAutoOpen({
  chatId,
  onOpen,
}: {
  chatId: string | null;
  onOpen: () => void;
}) {
  useSubAgentRenderCounter("SubAgentSidebarAutoOpen");
  const runsByChat = useSubAgentRunsByChat();
  const selectedRunId = useSubAgentSelectedRunId();
  const runCount = chatId ? runsByChat[chatId]?.length ?? 0 : 0;
  const previousRef = useRef({ chatId: null as string | null, runCount: 0 });

  useEffect(() => {
    const previous = previousRef.current;
    const chatChanged = previous.chatId !== chatId;
    const countIncreased = runCount > previous.runCount;
    previousRef.current = { chatId, runCount };

    if (!chatId || runCount === 0) return;
    if (chatChanged || countIncreased) onOpen();
  }, [chatId, onOpen, runCount]);

  useEffect(() => {
    if (selectedRunId) onOpen();
  }, [onOpen, selectedRunId]);

  return null;
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
