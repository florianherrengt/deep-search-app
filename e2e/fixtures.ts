import { test as base, expect, type Page } from "@playwright/test";

const TEST_SETTINGS = {
  chat_provider: "openrouter",
  openrouter_api_key: "test-key-e2e",
  anthropic_api_key: "",
  zhipu_api_key: "",
  zhipu_base_url: "",
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  default_model: "openrouter/auto",
  anthropic_model: "claude-sonnet-4-5",
  zhipu_model: "glm-4.7-flash",
  currency: "USD",
  chrome_devtools_mcp_enabled: false,
  embedding_api_key: "",
  embedding_base_url: "https://openrouter.ai/api/v1",
  embedding_model: "qwen/qwen3-embedding-4b",
  embedding_dimensions: 1024,
  embedding_query_prefix:
    "Represent this sentence for searching relevant passages: ",
  reranker_api_key: "",
  reranker_base_url: "https://openrouter.ai/api/v1",
  reranker_model: "cohere/rerank-4-pro",
};

type TestFixtures = {
  chatPage: Page;
};

export const test = base.extend<TestFixtures>({
  chatPage: async ({ page }, use) => {
    await page.addInitScript((settings) => {
      window.localStorage.setItem(
        "deep-search-test-settings",
        JSON.stringify(settings),
      );

      window.__deepSearchBridgeMock = {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
          globalThis.fetch(input, init),
        invoke: async () => undefined,
        loadStore: async () => ({
          get: async () => null,
          set: async () => {},
          save: async () => {},
        }),
        writeTextFile: async () => {},
        readTextFile: async () => "",
        exists: async () => false,
        readDir: async () => [],
        remove: async () => {},
        rename: async () => {},
        mkdir: async () => {},
        openUrl: async () => {},
        openPath: async () => {},
        setupMenu: async () => {},
        sendNotification: () => {},
        checkForUpdate: async () => null,
        relaunchApp: async () => {},
        appDataDir: async () => "/tmp/deep-search-test",
        join: async (...paths: string[]) => paths.join("/"),
      };
    }, TEST_SETTINGS);

    await page.goto("/");
    await page.waitForSelector('textarea[placeholder="Ask something..."]', {
      timeout: 10000,
    });
    await use(page);
  },
});

export { expect, TEST_SETTINGS };
export type { TestFixtures };
