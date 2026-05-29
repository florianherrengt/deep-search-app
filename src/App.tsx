import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import { subscribeResearchLibraryChanged } from "@/lib/research-library-events";
import {
  getChatModelOptions,
  getDefaultChatModelId,
} from "@/lib/chat-provider-settings";
import { type ChatModelConfig, type ChatProvider } from "@/lib/chat-providers";
import { Chat } from "@/components/chat";
import { SettingsPanel } from "@/components/settings-panel";
import { ToolsPanel } from "@/components/tools-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { TabPanel } from "@/components/tab-panel";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import { ResearchSidebar } from "@/components/research-sidebar";
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

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

function AppInner() {
  const { settings, loading, updateSetting } = useSettings();
  const { tabs, activeTabId, switchToTab, closeTab } = useBrowserTabs();
  const [researchFolders, setResearchFolders] = useState<ResearchFolder[]>([]);
  const [researchFoldersStatus, setResearchFoldersStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [activeResearchFolder, setActiveResearchFolder] = useState<
    string | null
  >(null);
  const activeResearchFolderRef = useRef(activeResearchFolder);
  activeResearchFolderRef.current = activeResearchFolder;
  const [researchChats, setResearchChats] = useState<ResearchChatSummary[]>([]);
  const [researchChatsStatus, setResearchChatsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [activeResearchChatId, setActiveResearchChatId] = useState(() =>
    createResearchChatId(),
  );
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState(() => createChatSessionId());
  const [selectedModelId, setSelectedModelId] = useState("");
  const chatModelOptions = useMemo(
    () => getChatModelOptions(settings),
    [settings],
  );
  const defaultChatModelId = useMemo(
    () => getDefaultChatModelId(settings, chatModelOptions),
    [settings, chatModelOptions],
  );
  const hasConfiguredChatProvider = chatModelOptions.some(
    (option) => !option.disabled,
  );

  const handleNewChat = useCallback(() => {
    const nextChatId = createResearchChatId();

    setActiveResearchFolder(null);
    setActiveResearchChatId(nextChatId);
    setResearchChats([]);
    setResearchChatsStatus("idle");
    setInitialMessages([]);
    setChatSessionId(createChatSessionId());
    switchToTab("main");
  }, [switchToTab]);

  const refreshResearchFolders = useCallback(async () => {
    setResearchFoldersStatus("loading");

    try {
      const folders = await listResearchFolders();
      setResearchFolders((currentFolders) =>
        mergeResearchFoldersWithCurrent(folders, currentFolders),
      );
      setResearchFoldersStatus("ready");
    } catch {
      setResearchFoldersStatus("error");
    }
  }, []);

  const refreshResearchChats = useCallback(async (folderName: string) => {
    setResearchChatsStatus("loading");

    try {
      setResearchChats(await listResearchChats(folderName));
      setResearchChatsStatus("ready");
    } catch {
      setResearchChats([]);
      setResearchChatsStatus("error");
    }
  }, []);

  useEffect(() => {
    setupMenu(
      () => switchToTab("settings"),
      handleNewChat,
    );
  }, [switchToTab, handleNewChat]);

  useEffect(() => {
    void refreshResearchFolders();
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

  if (loading) return null;

  const searchKeys = {
    braveApiKey: settings.brave_api_key || null,
    exaApiKey: settings.exa_api_key || null,
    serperApiKey: settings.serper_api_key || null,
    tavilyApiKey: settings.tavily_api_key || null,
    searxngBaseUrl: settings.searxng_url || null,
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

  if (!hasConfiguredChatProvider) {
    return (
      <>
        <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
          <h1 className="text-2xl font-bold">Deep Search</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Press{" "}
            <kbd className="rounded border px-1.5 py-0.5 text-xs">
              Cmd+,
            </kbd>{" "}
            to open settings and add at least one chat provider API key.
          </p>
        </main>
        <SettingsDialog
          open={true}
          onOpenChange={() => {}}
        />
      </>
    );
  }

  const handleSelectResearchFolder = async (folderName: string) => {
    setActiveResearchFolder(folderName);
    setResearchChatsStatus("loading");
    switchToTab("main");

    try {
      const chats = await listResearchChats(folderName);
      const selectedChatId = chats[0]?.id ?? createResearchChatId();
      const messages = chats[0]
        ? await readResearchChatMessages(folderName, selectedChatId)
        : [];

      setResearchChats(chats);
      setResearchChatsStatus("ready");
      setActiveResearchChatId(selectedChatId);
      setInitialMessages(messages);
      setChatSessionId(createChatSessionId());
    } catch {
      const nextChatId = createResearchChatId();
      setResearchChats([]);
      setResearchChatsStatus("error");
      setActiveResearchChatId(nextChatId);
      setInitialMessages([]);
      setChatSessionId(createChatSessionId());
    }
  };

  const handleSelectResearchChat = async (
    folderName: string,
    chatId: string,
  ) => {
    const messages = await readResearchChatMessages(folderName, chatId);
    setActiveResearchFolder(folderName);
    setActiveResearchChatId(chatId);
    setInitialMessages(messages);
    setChatSessionId(createChatSessionId());
    switchToTab("main");
  };

  const handleNewResearchChat = (folderName: string) => {
    const nextChatId = createResearchChatId();

    setActiveResearchFolder(folderName);
    setActiveResearchChatId(nextChatId);
    setInitialMessages([]);
    setChatSessionId(createChatSessionId());
    switchToTab("main");
  };

  const handleResearchFolderChange = (folderName: string) => {
    setActiveResearchFolder(folderName);
    setResearchFolders((folders) =>
      upsertRecentResearchFolder(folders, folderName),
    );
    void refreshResearchFolders();
    void refreshResearchChats(folderName);
  };

  const handleRenameResearchFolder = async (
    oldFolderName: string,
    newFolderName: string,
  ) => {
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

    if (activeResearchFolder === oldFolderName) {
      const messages = await readResearchChatMessages(
        renamed.name,
        activeResearchChatId,
      );
      setActiveResearchFolder(renamed.name);
      setInitialMessages(messages);
      setChatSessionId(createChatSessionId());
      void refreshResearchChats(renamed.name);
    }

    void refreshResearchFolders();
  };

  const handleDeleteResearchFolder = async (folderName: string) => {
    await deleteResearchFolder(folderName);

    setResearchFolders((folders) =>
      folders.filter((folder) => folder.name !== folderName),
    );

    if (activeResearchFolder === folderName) {
      const nextChatId = createResearchChatId();

      setActiveResearchFolder(null);
      setActiveResearchChatId(nextChatId);
      setResearchChats([]);
      setResearchChatsStatus("idle");
      setInitialMessages([]);
      setChatSessionId(createChatSessionId());
      switchToTab("main");
    }

    void refreshResearchFolders();
  };

  return (
    <TabPanel
      chatPanel={
        <div className="flex h-full overflow-hidden bg-background text-foreground">
          <ResearchSidebar
            folders={researchFolders}
            activeFolderName={activeResearchFolder}
            chats={researchChats}
            activeChatId={activeResearchChatId}
            apiKey={settings.openrouter_api_key}
            status={researchFoldersStatus}
            chatsStatus={researchChatsStatus}
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
          <div className="min-w-0 flex-1">
            <Chat
              key={chatSessionId}
              chatId={chatSessionId}
              researchChatId={activeResearchChatId}
              modelOptions={chatModelOptions}
              defaultModelId={defaultChatModelId}
              researchApiKey={settings.openrouter_api_key}
              researchFolder={activeResearchFolder}
              selectedModelId={effectiveSelectedModelId}
              initialMessages={initialMessages}
              onResearchFolderChange={handleResearchFolderChange}
              onSelectedModelIdChange={handleSelectedModelChange}
              searchKeys={searchKeys}
              onResearchChatSaved={(folderName) => {
                if (folderName === activeResearchFolderRef.current) {
                  void refreshResearchChats(folderName);
                }
              }}
            />
          </div>
        </div>
      }
      settingsPanel={<SettingsPanel />}
      toolsPanel={
        <ToolsPanel
          config={{
            researchFolder: activeResearchFolder,
            apiKey: settings.openrouter_api_key,
            getChatModel: getSelectedToolChatModel,
            ...searchKeys,
          }}
        />
      }
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={switchToTab}
      onCloseTab={closeTab}
    />
  );
}

function createChatSessionId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      <AppInner />
    </SettingsProvider>
  );
}

export default App;
