import { useCallback, useEffect, useState } from "react";
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
  deleteResearchFolder,
  listResearchFolders,
  readResearchChatMessages,
  renameResearchFolder,
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
    setActiveResearchFolder(null);
    setInitialMessages([]);
    setChatSessionId(createChatSessionId());
    switchToTab("main");
  };

  const handleSelectResearchFolder = async (folderName: string) => {
    const messages = await readResearchChatMessages(folderName);
    setActiveResearchFolder(folderName);
    setInitialMessages(messages);
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
      const messages = await readResearchChatMessages(renamed.name);
      setActiveResearchFolder(renamed.name);
      setInitialMessages(messages);
      setChatSessionId(createChatSessionId());
    }

    void refreshResearchFolders();
  };

  const handleDeleteResearchFolder = async (folderName: string) => {
    await deleteResearchFolder(folderName);

    setResearchFolders((folders) =>
      folders.filter((folder) => folder.name !== folderName),
    );

    if (activeResearchFolder === folderName) {
      setActiveResearchFolder(null);
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
            apiKey={settings.openrouter_api_key}
            status={researchFoldersStatus}
            onNewChat={handleNewChat}
            onSelectFolder={(folderName) => {
              void handleSelectResearchFolder(folderName);
            }}
            onRenameFolder={handleRenameResearchFolder}
            onDeleteFolder={handleDeleteResearchFolder}
          />
          <div className="min-w-0 flex-1">
            <Chat
              key={chatSessionId}
              chatId={chatSessionId}
              apiKey={settings.openrouter_api_key}
              defaultModel={settings.default_model}
              researchFolder={activeResearchFolder}
              initialMessages={initialMessages}
              onResearchFolderChange={handleResearchFolderChange}
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
