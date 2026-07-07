import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import { SkillsProvider } from "@/hooks/use-skills";
import { setupMenu } from "@/lib/tauri-bridge";
import {
  getChatModelOptions,
  getDefaultChatModelId,
} from "@/lib/chat-provider-settings";
import { type ChatModelConfig, type ChatProvider } from "@/lib/chat-providers";
import { SettingsPanel } from "@/components/settings-panel";
import { ToolsPanel } from "@/components/tools-panel";
import { PromptTemplatesSection } from "@/components/prompt-templates-section";
import { SkillsSection } from "@/components/skills-section";
import { getCurrencyConversionTarget } from "@/lib/settings-store";

import { TabPanel } from "@/components/tab-panel";
import { AppUpdateButton } from "@/components/app-update-button";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { useResearchWorkspace } from "@/hooks/use-research-workspace";
import { useWebviewZoom } from "@/hooks/use-webview-zoom";
import { ResearchSidebar } from "@/components/research-sidebar";
import { SubAgentProvider, useSubAgentActions } from "@/lib/sub-agent-store";
import { SubAgentSidebar } from "@/components/sub-agent-sidebar";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";

const LazyChat = lazy(() =>
  import("@/components/chat").then((m) => ({ default: m.Chat })),
);

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

function AppInner() {
  useSubAgentRenderCounter("AppInner");

  const { settings, loading, error: settingsError, updateSetting } = useSettings();
  const { processEvent } = useSubAgentActions();
  const { tabs, activeTabId, switchToTab, closeTab } = useBrowserTabs();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [subAgentSidebarOpen, setSubAgentSidebarOpen] = useState(false);
  const chatModelOptions = useMemo(
    () => getChatModelOptions(settings),
    [settings],
  );
  const defaultChatModelId = useMemo(
    () => getDefaultChatModelId(settings, chatModelOptions),
    [settings, chatModelOptions],
  );

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

  // Memoized: Chat's effectiveSearchKeys useMemo depends on this reference.
  // An unmemoized inline object would defeat that memo and re-run the spread
  // on every AppInner render (which happens on folder/attention transitions).
  const searchKeys = useMemo(
    () => ({
      braveApiKey: settings.brave_api_key || null,
      exaApiKey: settings.exa_api_key || null,
      serperApiKey: settings.serper_api_key || null,
      tavilyApiKey: settings.tavily_api_key || null,
      youtubeApiKey: settings.youtube_api_key || null,
      scrapeDoApiKey: settings.scrape_do_api_key || null,
      youtubeYtDlpPath: settings.youtube_ytdlp_path || null,
      searxngBaseUrl: settings.searxng_url || null,
      currency: getCurrencyConversionTarget(settings.currency),
      chromeDevToolsMcpEnabled: settings.chrome_devtools_mcp_enabled,
      chromeDevToolsMcpConnectionMode: settings.chrome_devtools_mcp_connection_mode,
      chromeDevToolsMcpBrowserUrl: settings.chrome_devtools_mcp_browser_url || null,
      chromeDevToolsMcpNodePath: settings.chrome_devtools_mcp_node_path || null,
      webExtractionBackend: settings.web_extraction_backend,
    }),
    [
      settings.brave_api_key,
      settings.exa_api_key,
      settings.serper_api_key,
      settings.tavily_api_key,
      settings.youtube_api_key,
      settings.scrape_do_api_key,
      settings.youtube_ytdlp_path,
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

  const {
    activeResearchChatId,
    activeResearchFolder,
    activeSessionId,
    activateSession,
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
  } = useResearchWorkspace({
    bridgeEnabled: !loading,
    getChatModel: getSelectedToolChatModel,
    processSubAgentEvent: processEvent,
    searchKeys,
    switchToTab,
  });

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

  const { zoomIn, zoomOut, resetZoom } = useWebviewZoom(
    settings.zoom_level,
    updateSetting,
    !loading,
  );

  useEffect(() => {
    setupMenu(
      () => switchToTab("settings"),
      handleNewChat,
      { onZoomIn: zoomIn, onZoomOut: zoomOut, onResetZoom: resetZoom },
    );
  }, [switchToTab, handleNewChat, zoomIn, zoomOut, resetZoom]);

  useDesktopNotifications({
    sessions: chatSessions,
    activeSessionId,
    activateSession,
    switchToTab,
  });

  const chatModelOptionsRef = useRef(chatModelOptions);
  chatModelOptionsRef.current = chatModelOptions;

  const handleSelectedModelChange = useCallback((modelId: string) => {
    const selected = chatModelOptionsRef.current.find(
      (option) => option.id === modelId && !option.disabled,
    );
    if (!selected) return;

    setSelectedModelId(modelId);
    updateDefaultChatProvider(selected.provider);
  }, [updateDefaultChatProvider]);

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
                      onResearchChatSaved={handleResearchChatSaved}
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
