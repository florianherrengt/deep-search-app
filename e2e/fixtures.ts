import { test as base, expect, type Page } from "@playwright/test";

const TEST_SETTINGS = {
  chat_provider: "openrouter",
  openrouter_api_key: "",
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
};

type TestFixtures = {
  chatPage: Page;
  configuredChatPage: Page;
};

async function setupPage(page: Page, settings: typeof TEST_SETTINGS) {
  await page.addInitScript((s) => {
    window.localStorage.setItem(
      "deep-search-test-settings",
      JSON.stringify(s),
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
  }, settings);

  await page.goto("/");
  await page.waitForSelector('textarea[placeholder="Ask something..."]', {
    timeout: 10000,
  });
}

const CONFIGURED_SETTINGS = { ...TEST_SETTINGS, openrouter_api_key: "test-key-e2e" };

export const test = base.extend<TestFixtures>({
  chatPage: async ({ page }, use) => {
    await setupPage(page, TEST_SETTINGS);
    await use(page);
  },

  configuredChatPage: async ({ page }, use) => {
    await setupPage(page, CONFIGURED_SETTINGS);
    await use(page);
  },
});

export { expect, TEST_SETTINGS };
export type { TestFixtures };
