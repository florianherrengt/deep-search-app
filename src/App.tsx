import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import {
  setBraveApiKey,
  setExaApiKey,
  setSerperApiKey,
  setTavilyApiKey,
  setSearXNGBaseUrl,
} from "@/lib/transport";
import { Chat } from "@/components/chat";
import { SettingsPanel } from "@/components/settings-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { TabPanel } from "@/components/tab-panel";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import { ResearchSidebar } from "@/components/research-sidebar";
import {
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
  const { settings, loading } = useSettings();
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

  const refreshResearchFolders = useCallback(async () => {
    setResearchFoldersStatus("loading");

    try {
      setResearchFolders(await listResearchFolders());
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
    setupMenu(() => switchToTab("settings"));
  }, [switchToTab]);

  useEffect(() => {
    void refreshResearchFolders();
  }, [refreshResearchFolders]);

  useEffect(() => {
    if (settings.brave_api_key) setBraveApiKey(settings.brave_api_key);
    if (settings.exa_api_key) setExaApiKey(settings.exa_api_key);
    if (settings.serper_api_key) setSerperApiKey(settings.serper_api_key);
    if (settings.tavily_api_key) setTavilyApiKey(settings.tavily_api_key);
    if (settings.searxng_url) setSearXNGBaseUrl(settings.searxng_url);
  }, [settings]);

  if (loading) return null;

  if (!settings.openrouter_api_key) {
    return (
      <>
        <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
          <h1 className="text-2xl font-bold">Deep Search</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Press{" "}
            <kbd className="rounded border px-1.5 py-0.5 text-xs">
              Cmd+,
            </kbd>{" "}
            to open settings and add your OpenRouter API key.
          </p>
        </main>
        <SettingsDialog
          open={true}
          onOpenChange={() => {}}
        />
      </>
    );
  }

  const handleNewChat = () => {
    const nextChatId = createResearchChatId();

    setActiveResearchFolder(null);
    setActiveResearchChatId(nextChatId);
    setResearchChats([]);
    setResearchChatsStatus("idle");
    setInitialMessages([]);
    setChatSessionId(createChatSessionId());
    switchToTab("main");
  };

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
      folders.some((folder) => folder.name === folderName)
        ? folders
        : [...folders, { name: folderName }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
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
        .map((folder) => (folder.name === oldFolderName ? renamed : folder))
        .sort((a, b) => a.name.localeCompare(b.name)),
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
              apiKey={settings.openrouter_api_key}
              defaultModel={settings.default_model}
              researchFolder={activeResearchFolder}
              initialMessages={initialMessages}
              onResearchFolderChange={handleResearchFolderChange}
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

function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  );
}

export default App;
