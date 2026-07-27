// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { theme } from "@/lib/theme";
import type {
  ResearchChatSummary,
  ResearchFolder,
} from "@/lib/research-history";

const appMocks = vi.hoisted(() => ({
  settingsLoading: true,
  settingsError: null as Error | null,
  bridgeHandler: null as ((body: unknown) => Promise<unknown>) | null,
  chatIdCounter: 0,
  closeTab: vi.fn(),
  deleteResearchFolder: vi.fn(async () => undefined),
  fetch: vi.fn(async () => new Response()),
  listResearchChats: vi.fn<() => Promise<ResearchChatSummary[]>>(
    async () => [],
  ),
  listResearchFolders: vi.fn<() => Promise<ResearchFolder[]>>(async () => []),
  readResearchChatMessages: vi.fn<() => Promise<UIMessage[]>>(async () => []),
  renameResearchFolder: vi.fn(async (_oldName: string, newName: string) => ({
    name: newName,
    updatedAt: null,
  })),
  resetAll: vi.fn(async () => undefined),
  researchSidebar: vi.fn(),
  setupMenu: vi.fn(async () => undefined),
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
    youtube_api_key: "",
    youtube_ytdlp_path: "",
    scrape_do_api_key: "",
    searxng_url: "",
    currency: "USD",
    google_search_enabled: true,
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
  useSubAgentActions: () => ({
    processEvent: vi.fn(),
  }),
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
  isTauri: () => false,
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

vi.mock("@/lib/mcp/deep-search-app-bridge", () => ({
  startDeepSearchMcpBridge: vi.fn(
    async (handler: (body: unknown) => Promise<unknown>) => {
      appMocks.bridgeHandler = handler;
      return () => undefined;
    },
  ),
}));

vi.mock("@/lib/mcp/deep-search-session-manager", () => ({
  DeepSearchSessionManager: class {
    private config: {
      onResearchChatSaved?: (folderName: string, chatId: string) => void;
    };

    constructor(config: {
      onResearchChatSaved?: (folderName: string, chatId: string) => void;
    }) {
      this.config = config;
    }

    setConfig(config: {
      onResearchChatSaved?: (folderName: string, chatId: string) => void;
    }) {
      this.config = config;
    }

    async handle() {
      this.config.onResearchChatSaved?.("mcp-folder", "mcp-chat");
      return { session_id: "mcp-session", status: "done", result: "done" };
    }
  },
}));

vi.mock("@/components/tab-panel", () => ({
  TabPanel: ({ chatPanel }: { chatPanel: ReactNode }) => chatPanel,
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
  ResearchSidebar: (props: {
    folders: Array<{ name: string }>;
    chats: Array<{ title: string }>;
  }) => {
    appMocks.researchSidebar(props);
    return [
      ...props.folders.map((folder) => folder.name),
      ...props.chats.map((chat) => chat.title),
    ].join(" ");
  },
}));

vi.mock("@/components/sub-agent-sidebar", () => ({
  SubAgentSidebar: () => null,
}));

vi.mock("@/components/chat", () => ({
  Chat: () => null,
}));

vi.mock("@/components/app-update-button", () => ({
  AppUpdateButton: () => null,
}));

import App from "@/App";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function TestApp({ strict = false }: { strict?: boolean }) {
  const app = (
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  );
  return strict ? <StrictMode>{app}</StrictMode> : app;
}

afterEach(() => {
  cleanup();
  appMocks.settingsLoading = true;
  appMocks.settingsError = null;
  appMocks.bridgeHandler = null;
  appMocks.chatIdCounter = 0;
  vi.clearAllMocks();
});

describe("App", () => {
  it("initializes the native app menu once under React StrictMode", async () => {
    appMocks.settingsLoading = false;

    render(<TestApp strict />);

    await waitFor(() => expect(appMocks.setupMenu).toHaveBeenCalledTimes(1));
  });

  it("keeps AppInner hook order stable when settings finish loading", () => {
    const { rerender } = render(<TestApp />);

    appMocks.settingsLoading = false;

    expect(() => rerender(<TestApp />)).not.toThrow();
  });

  it("opens MCP-saved research chats in the main research UI", async () => {
    appMocks.settingsLoading = false;
    appMocks.listResearchFolders.mockResolvedValue([]);
    appMocks.listResearchChats.mockResolvedValue([
      {
        id: "mcp-chat",
        title: "MCP chat",
        createdAt: "2026-07-03T17:00:00.000Z",
        updatedAt: "2026-07-03T17:00:01.000Z",
        messageCount: 2,
      },
    ]);
    appMocks.readResearchChatMessages.mockResolvedValue([
      {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Question" }],
      },
      {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Answer" }],
      },
    ]);

    render(<TestApp />);

    await waitFor(() => expect(appMocks.bridgeHandler).toBeTruthy());

    await act(async () => {
      await appMocks.bridgeHandler?.({ question: "test" });
    });

    await waitFor(() => {
      const latestCall =
        appMocks.researchSidebar.mock.calls[
          appMocks.researchSidebar.mock.calls.length - 1
        ];
      const latestProps = latestCall?.[0];
      expect(latestProps?.activeFolderName).toBe("mcp-folder");
      expect(latestProps?.activeChatId).toBe("mcp-chat");
    });

    expect(screen.getByText(/mcp-folder/)).toBeTruthy();
    expect(screen.getByText(/MCP chat/)).toBeTruthy();
    expect(appMocks.switchToTab).toHaveBeenCalledWith("main");
    expect(appMocks.listResearchChats).toHaveBeenCalledWith("mcp-folder");
    expect(appMocks.readResearchChatMessages).toHaveBeenCalledWith(
      "mcp-folder",
      "mcp-chat",
    );
  });
});
