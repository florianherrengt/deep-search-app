// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const appMocks = vi.hoisted(() => ({
  settingsLoading: true,
  settingsError: null as Error | null,
  chatIdCounter: 0,
  closeTab: vi.fn(),
  deleteResearchFolder: vi.fn(async () => undefined),
  fetch: vi.fn(async () => new Response()),
  listResearchChats: vi.fn(async () => []),
  listResearchFolders: vi.fn(async () => []),
  readResearchChatMessages: vi.fn(async () => []),
  renameResearchFolder: vi.fn(async (_oldName: string, newName: string) => ({
    name: newName,
    updatedAt: null,
  })),
  resetAll: vi.fn(async () => undefined),
  setupMenu: vi.fn(),
  subscribeResearchLibraryChanged: vi.fn(() => () => undefined),
  switchToTab: vi.fn(),
  updateSetting: vi.fn(async () => undefined),
  settings: {
    chat_provider: "openrouter",
    openrouter_api_key: "",
    brave_api_key: "",
    exa_api_key: "",
    serper_api_key: "",
    tavily_api_key: "",
    scrape_do_api_key: "",
    searxng_url: "",
    currency: "USD",
    chrome_devtools_mcp_enabled: false,
    chrome_devtools_mcp_connection_mode: "auto",
    chrome_devtools_mcp_browser_url: "",
    chrome_devtools_mcp_node_path: "",
    web_extraction_backend: "tauri-webview",
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
  useSettings: () => ({
    settings: appMocks.settings,
    loading: appMocks.settingsLoading,
    error: appMocks.settingsError,
    updateSetting: appMocks.updateSetting,
    resetAll: appMocks.resetAll,
  }),
}));

vi.mock("@/hooks/use-prompt-templates", () => ({
  PromptTemplatesProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/hooks/use-skills", () => ({
  SkillsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/sub-agent-store", () => ({
  SubAgentProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/hooks/use-browser-tabs", () => ({
  useBrowserTabs: () => ({
    tabs: [],
    activeTabId: "main",
    switchToTab: appMocks.switchToTab,
    closeTab: appMocks.closeTab,
  }),
}));

vi.mock("@/hooks/use-desktop-notifications", () => ({
  useDesktopNotifications: () => undefined,
}));

vi.mock("@/lib/sub-agent-profiler", () => ({
  useSubAgentRenderCounter: () => undefined,
}));

vi.mock("@/lib/tauri-bridge", () => ({
  fetch: appMocks.fetch,
  setupMenu: appMocks.setupMenu,
}));

vi.mock("@/lib/research-library-events", () => ({
  subscribeResearchLibraryChanged: appMocks.subscribeResearchLibraryChanged,
}));

vi.mock("@/lib/research-history", () => ({
  compareResearchFolders: () => 0,
  createResearchChatId: () => {
    appMocks.chatIdCounter += 1;
    return `research-chat-${appMocks.chatIdCounter}`;
  },
  deleteResearchFolder: appMocks.deleteResearchFolder,
  listResearchChats: appMocks.listResearchChats,
  listResearchFolders: appMocks.listResearchFolders,
  readResearchChatMessages: appMocks.readResearchChatMessages,
  renameResearchFolder: appMocks.renameResearchFolder,
}));

vi.mock("@/lib/chat-provider-settings", () => ({
  getChatModelOptions: () => [],
  getDefaultChatModelId: () => "",
}));

vi.mock("@/components/tab-panel", () => ({
  TabPanel: () => "app ready",
}));

vi.mock("@/components/settings-panel", () => ({
  SettingsPanel: () => null,
}));

vi.mock("@/components/tools-panel", () => ({
  ToolsPanel: () => null,
}));

vi.mock("@/components/prompt-templates-section", () => ({
  PromptTemplatesSection: () => null,
}));

vi.mock("@/components/skills-section", () => ({
  SkillsSection: () => null,
}));

vi.mock("@/components/research-sidebar", () => ({
  ResearchSidebar: () => null,
}));

vi.mock("@/components/sub-agent-sidebar", () => ({
  SubAgentSidebar: () => null,
}));

vi.mock("@/components/app-update-button", () => ({
  AppUpdateButton: () => null,
}));

import App from "@/App";

afterEach(() => {
  cleanup();
  appMocks.settingsLoading = true;
  appMocks.settingsError = null;
  appMocks.chatIdCounter = 0;
  vi.clearAllMocks();
});

describe("App", () => {
  it("keeps AppInner hook order stable when settings finish loading", () => {
    const { rerender } = render(<App />);

    appMocks.settingsLoading = false;

    expect(() => rerender(<App />)).not.toThrow();
    expect(screen.getByText("app ready")).toBeTruthy();
  });
});
