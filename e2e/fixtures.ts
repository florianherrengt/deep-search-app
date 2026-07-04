import { test as base, expect, type Page } from "@playwright/test";
import {
  setupMockedAppPage,
  TEST_SETTINGS,
  type TestSettings,
} from "./helpers/chat";

type TestFixtures = {
  chatPage: Page;
  configuredChatPage: Page;
};

const CONFIGURED_SETTINGS = { ...TEST_SETTINGS, openrouter_api_key: "test-key-e2e" };

export const test = base.extend<TestFixtures>({
  chatPage: async ({ page }, use) => {
    await setupMockedAppPage(page, TEST_SETTINGS);
    await use(page);
  },

  configuredChatPage: async ({ page }, use) => {
    await setupMockedAppPage(page, CONFIGURED_SETTINGS);
    await use(page);
  },
});

export { expect, TEST_SETTINGS };
export type { TestSettings };
export type { TestFixtures };
