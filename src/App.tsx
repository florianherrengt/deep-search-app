import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Center,
  Drawer,
  Loader,
  Stack,
  Text,
  Title,
  rem,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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
  const [researchSidebarOpen, setResearchSidebarOpen] = useState(false);
  const researchSidebarIsDrawer = useMediaQuery("(max-width: 64em)");
  const subAgentSidebarIsDrawer = useMediaQuery("(max-width: 75em)");
  const menuSetupStartedRef = useRef(false);
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
      googleSearchEnabled: settings.google_search_enabled,
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
      settings.google_search_enabled,
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
    handleSearchChats,
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

  const closeResearchSidebar = useCallback(() => {
    setResearchSidebarOpen(false);
  }, []);

  const handleToggleSubAgentSidebar = useCallback(() => {
    if (activeTabId !== "main") {
      switchToTab("main");
    }
    if (!activeResearchChatId) return;
    setSubAgentSidebarOpen((prev) => !prev);
  }, [activeTabId, activeResearchChatId, switchToTab]);

  useEffect(() => {
    if (activeTabId === "main") return;
    setResearchSidebarOpen(false);
    setSubAgentSidebarOpen(false);
  }, [activeTabId]);

  const { zoomIn, zoomOut, resetZoom } = useWebviewZoom(
    settings.zoom_level,
    updateSetting,
    !loading,
  );

  useEffect(() => {
    if (menuSetupStartedRef.current) return;
    menuSetupStartedRef.current = true;

    void setupMenu(
      () => switchToTab("settings"),
      handleNewChat,
      { onZoomIn: zoomIn, onZoomOut: zoomOut, onResetZoom: resetZoom },
    ).catch((error) => {
      menuSetupStartedRef.current = false;
      console.error("[menu] Failed to initialize the app menu:", error);
    });
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

  if (loading) {
    return (
      <Center mih="100dvh" p="xl">
        <Stack align="center" gap="sm" role="status" aria-live="polite">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading your workspace…</Text>
        </Stack>
      </Center>
    );
  }

  if (settingsError) {
    return (
      <Center mih="100dvh" p="xl">
        <Alert color="red" variant="light" maw={rem(480)} role="alert">
          <Stack gap="sm">
            <Stack gap={4}>
              <Title order={1} size="h4">Could not load settings</Title>
              <Text size="sm">{settingsError.message}</Text>
            </Stack>
            <Button color="red" variant="light" w="fit-content" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </Stack>
        </Alert>
      </Center>
    );
  }

  const researchSidebar = (
    <ResearchSidebar
      width={researchSidebarIsDrawer ? "100%" : "var(--app-sidebar-width)"}
      folders={researchFolders}
      activeFolderName={activeResearchFolder}
      chats={researchChats}
      activeChatId={activeResearchChatId}
      searchChats={handleSearchChats}
      status={researchFoldersStatus}
      chatsStatus={researchChatsStatus}
      runningFolderNames={runningFolderNames}
      runningChatIds={runningChatIds}
      attentionFolderNames={attentionFolderNames}
      attentionChatIds={attentionChatIds}
      onNewChat={() => {
        closeResearchSidebar();
        handleNewChat();
      }}
      onSelectFolder={(folderName) => {
        closeResearchSidebar();
        void handleSelectResearchFolder(folderName);
      }}
      onNewResearchChat={(folderName) => {
        closeResearchSidebar();
        handleNewResearchChat(folderName);
      }}
      onSelectChat={(folderName, chatId) => {
        closeResearchSidebar();
        void handleSelectResearchChat(folderName, chatId);
      }}
      onRenameFolder={handleRenameResearchFolder}
      onDeleteFolder={handleDeleteResearchFolder}
    />
  );

  return (
    <>
      <TabPanel
        chatPanel={
          <div className="md-flex-row">
          {!researchSidebarIsDrawer ? researchSidebar : null}
          <div className="md-flex-fill" style={{ display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {mountedChatSessions.map((session) => (
                <div
                  key={session.sessionId}
                  style={{ height: "100%" }}
                  hidden={session.sessionId !== activeSessionId}
                >
                  <Suspense
                    fallback={
                      <Center h="100%" role="status" aria-label="Loading conversation">
                        <Loader size="sm" />
                      </Center>
                    }
                  >
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
            {!subAgentSidebarIsDrawer && subAgentSidebarOpen && activeResearchChatId && (
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
        navigationOpen={researchSidebarOpen}
        onToggleNavigation={
          researchSidebarIsDrawer && activeTabId === "main"
            ? () => setResearchSidebarOpen((open) => !open)
            : undefined
        }
        subAgentSidebarOpen={subAgentSidebarOpen}
        subAgentSidebarDisabled={!activeResearchChatId}
        onToggleSubAgentSidebar={handleToggleSubAgentSidebar}
        toolbarEnd={<AppUpdateButton />}
        onSwitchTab={switchToTab}
        onCloseTab={closeTab}
      />

      {researchSidebarIsDrawer ? (
        <Drawer
          opened={researchSidebarOpen && activeTabId === "main"}
          onClose={closeResearchSidebar}
          title="Research"
          position="left"
          size={320}
          padding={0}
          closeButtonProps={{ "aria-label": "Close research navigation" }}
          styles={{
            content: { display: "flex", flexDirection: "column" },
            header: { minHeight: rem(48), padding: `0 ${rem(12)}` },
            body: { display: "flex", flex: 1, minHeight: 0, padding: 0 },
          }}
        >
          {researchSidebar}
        </Drawer>
      ) : null}

      {subAgentSidebarIsDrawer && activeResearchChatId ? (
        <Drawer
          opened={subAgentSidebarOpen && activeTabId === "main"}
          onClose={closeSubAgentSidebar}
          aria-label="Sub-agents"
          position="right"
          size={480}
          padding={0}
          withCloseButton={false}
          styles={{
            content: { display: "flex", flexDirection: "column" },
            body: { display: "flex", flex: 1, minHeight: 0, padding: 0 },
          }}
        >
          <SubAgentSidebar
            chatId={activeResearchChatId}
            onClose={closeSubAgentSidebar}
            width="100%"
          />
        </Drawer>
      ) : null}
    </>
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
