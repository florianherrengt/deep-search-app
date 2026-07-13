import { test, expect } from "../fixtures";
import {
  clickAppTab,
  clickButtonWithText,
  ensureChatUI,
  getFileStorageLog,
  heldTextResponse,
  installAppFileStorageMock,
  installOpenRouterMock,
  installSearxngSearchMock,
  installTauriWebviewExtractionMock,
  refreshResearchLibraryFromMock,
  releaseHeldOpenRouterResponse,
  releaseTauriWebviewExtractionMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForHeldOpenRouterResponse,
  waitForOpenRouterStreamEvent,
  waitForTauriWebviewExtractionMock,
  waitForText,
} from "../helpers/chat";

test.describe("Migrated research sidebar", () => {
  test("orders previous searches by latest saved chat update", async ({
    chatPage,
  }) => {
    await installAppFileStorageMock(chatPage, {
      "search-results/older-topic/chats/2026-05-21T10-00-00.000Z.json":
        JSON.stringify(savedChat({
          id: "2026-05-21T10-00-00.000Z",
          title: "Older topic",
          createdAt: "2026-05-21T10:00:00.000Z",
          updatedAt: "2026-05-21T10:30:00.000Z",
        })),
      "search-results/latest-topic/chats/2026-05-23T10-00-00.000Z.json":
        JSON.stringify(savedChat({
          id: "2026-05-23T10-00-00.000Z",
          title: "Latest topic",
          createdAt: "2026-05-23T10:00:00.000Z",
          updatedAt: "2026-05-23T10:30:00.000Z",
        })),
    });

    await expect
      .poll(async () => {
        await refreshResearchLibraryFromMock(chatPage);
        return sidebarFolderTitles(chatPage);
      }, { timeout: 5000 })
      .toEqual(["latest-topic", "older-topic"]);
  });

  test("updates previous searches when a research file is saved", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);

    await expect
      .poll(async () => {
        await refreshResearchLibraryFromMock(configuredChatPage);
        return configuredChatPage.getByTestId("research-sidebar").innerText();
      }, { timeout: 5000 })
      .toContain("No searches yet");

    const folderName = `e2e-sidebar-refresh-${Date.now()}`;
    const prompt = folderName.replace(/-/g, " ");

    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("create_file", {
        filename: "notes.md",
        content: "Saved from e2e test",
      }),
      textResponse(JSON.stringify({ folderName })),
      textResponse("Saved the research file."),
    ]);

    await sendMessage(configuredChatPage, prompt);

    await configuredChatPage.waitForFunction(
      () => ((window as any).__logs || []).length > 0,
      undefined,
      { timeout: 5000, polling: 250 },
    );

    await expect(configuredChatPage.getByTestId("research-sidebar")).toContainText(
      folderName,
      { timeout: 15000 },
    );
  });
});

test.describe("Migrated background research", () => {
  test("keeps a running search alive when switching app tabs", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    const releaseKey = "tab-switch-background";
    const finalText = "Tab switch background run completed.";

    await installOpenRouterMock(configuredChatPage, [
      textResponse("thinking"),
      heldTextResponse(finalText, releaseKey),
    ]);

    await sendMessage(configuredChatPage, "Alpha background research");
    await waitForHeldOpenRouterResponse(configuredChatPage, releaseKey);

    await clickAppTab(configuredChatPage, "prompts");
    await releaseHeldOpenRouterResponse(configuredChatPage, releaseKey);

    await waitForOpenRouterStreamEvent(configuredChatPage, releaseKey, "completed");
    expect(await streamWasCancelled(configuredChatPage, releaseKey)).toBe(false);

    await clickAppTab(configuredChatPage, "main");
    await waitForText(configuredChatPage, finalText);
  });

  test("keeps the first search running after starting a new search", async ({
    configuredChatPage,
  }) => {
    await installAppFileStorageMock(configuredChatPage);
    const firstReleaseKey = "first-background-run";
    const firstFinalText = "First background run completed.";
    const secondFinalText = "Second background run completed.";

    await installOpenRouterMock(configuredChatPage, [
      textResponse(firstFinalText),
      heldTextResponse(firstFinalText, firstReleaseKey),
      textResponse(secondFinalText),
      textResponse(secondFinalText),
    ]);

    await sendMessage(configuredChatPage, "First background research");
    await waitForHeldOpenRouterResponse(configuredChatPage, firstReleaseKey);

    await clickButtonWithText(configuredChatPage, "New chat");
    await sendMessage(configuredChatPage, "Second background research");
    await waitForText(configuredChatPage, secondFinalText);

    expect(await streamWasCancelled(configuredChatPage, firstReleaseKey)).toBe(false);

    await releaseHeldOpenRouterResponse(configuredChatPage, firstReleaseKey);
    await waitForOpenRouterStreamEvent(configuredChatPage, firstReleaseKey, "completed");
    expect(await streamWasCancelled(configuredChatPage, firstReleaseKey)).toBe(false);

    const firstFolder = await getFirstResearchFolderName(configuredChatPage);
    expect(firstFolder).toBeTruthy();

    await selectResearchFolder(configuredChatPage, firstFolder!);
    await waitForText(configuredChatPage, firstFinalText);
  });
});

test.describe("Migrated extraction webview tabs", () => {
  test("shows the extraction webview as a tab while extract_page_content is running", async ({
    configuredChatPage,
  }) => {
    await ensureChatUI(configuredChatPage, {
      openrouter_api_key: "test-key-e2e",
      searxng_url: "http://localhost:8080",
    });
    await installAppFileStorageMock(configuredChatPage);
    await installSearxngSearchMock(configuredChatPage);
    const url = "https://example.com/e2e-webview-tab";

    await installTauriWebviewExtractionMock(
      configuredChatPage,
      `
      <html>
        <body>
          <main>
            <h1>Mock extraction page</h1>
            <p>Content returned from the mocked Tauri webview extraction.</p>
          </main>
        </body>
      </html>
    `,
    );

    await installOpenRouterMock(configuredChatPage, [
      toolCallResponse("searxng_search", {
        query: "example page",
      }),
      toolCallResponse("extract_page_content", {
        url,
        summarize: false,
        method: "webview",
      }),
      textResponse("Extraction complete"),
    ]);

    await sendMessage(configuredChatPage, "Extract the example page");
    await waitForTauriWebviewExtractionMock(configuredChatPage);

    await waitForBrowserTab(configuredChatPage, url, true, {
      timeout: 15000,
      timeoutMsg: "Expected extraction tab to appear while webview is open",
    });

    await expect(
      configuredChatPage.locator(`[data-testid="browser-tab"][data-tab-url="${url}"]`),
    ).toHaveAttribute("data-active", "true");

    await releaseTauriWebviewExtractionMock(configuredChatPage);

    await waitForBrowserTab(configuredChatPage, url, false, {
      timeout: 15000,
      timeoutMsg: "Expected extraction tab to close after webview extraction",
    });
    await waitForText(configuredChatPage, "Extraction complete");

    const commandNames = await configuredChatPage.evaluate(() =>
      ((window as any).__deepSearchWebviewExtractionLog || []).map(
        (entry: any) => entry.cmd,
      ),
    );
    expect(commandNames).toContain("open_tab");
    expect(commandNames).toContain("extract_content");
    expect(commandNames).toContain("close_tab");
  });
});

async function streamWasCancelled(
  page: import("@playwright/test").Page,
  releaseKey: string,
) {
  return page.evaluate(
    (key) =>
      ((window as any).__logs || []).some(
        (entry: any) =>
          entry.kind === "openrouter-stream" &&
          entry.releaseKey === key &&
          entry.event === "cancelled",
      ),
    releaseKey,
  );
}

async function getFirstResearchFolderName(page: import("@playwright/test").Page) {
  const log = await getFileStorageLog(page);
  const writeEntries = log.filter(
    (entry: any) =>
      entry.action === "write" &&
      entry.subfolder &&
      entry.subfolder.includes("/chats"),
  );
  if (writeEntries.length === 0) return null;
  const match = writeEntries[0].subfolder.match(/^search-results\/([^/]+)\//);
  return match ? match[1] : null;
}

async function selectResearchFolder(
  page: import("@playwright/test").Page,
  folderName: string,
) {
  const button = page.locator(
    `[data-testid="research-sidebar"] button[title="${folderName}"]`,
  );
  await expect(button).toBeVisible({ timeout: 10000 });
  await button.click();
}

async function sidebarFolderTitles(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="research-sidebar"] button[title]'),
    ).map((button) => button.getAttribute("title")),
  );
}

async function waitForBrowserTab(
  page: import("@playwright/test").Page,
  url: string,
  expected: boolean,
  options: { timeout: number; timeoutMsg: string },
) {
  try {
    await page.waitForFunction(
      ({ targetUrl, expectedState }) =>
        Boolean(
          document.querySelector(
            `[data-testid="browser-tab"][data-tab-url="${targetUrl}"]`,
          ),
        ) === expectedState,
      { targetUrl: url, expectedState: expected },
      { timeout: options.timeout, polling: 250 },
    );
  } catch (error) {
    const debug = await page.evaluate((targetUrl) => ({
      appTabs: Array.from(document.querySelectorAll('[data-testid="app-tab"]'))
        .map((tab) => ({
          id: tab.getAttribute("data-tab-id"),
          text: tab.textContent?.trim() ?? "",
          variant: tab.getAttribute("data-variant"),
        })),
      browserTabs: Array.from(
        document.querySelectorAll('[data-testid="browser-tab"]'),
      ).map((tab) => ({
        id: tab.getAttribute("data-tab-id"),
        url: tab.getAttribute("data-tab-url"),
        text: tab.textContent?.trim() ?? "",
        variant: tab.getAttribute("data-variant"),
      })),
      extractionLog: (window as any).__deepSearchWebviewExtractionLog || [],
      browserErrors: (window as any).__deepSearchBrowserErrors || [],
      bodyText: (document.body?.innerText || "").slice(0, 1000),
      targetUrl,
    }), url);
    throw new Error(
      `${options.timeoutMsg}. Debug: ${JSON.stringify(debug)}`,
      { cause: error },
    );
  }
}

function savedChat({
  id,
  title,
  createdAt,
  updatedAt,
}: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id,
    title,
    createdAt,
    updatedAt,
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: title }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Done" }],
      },
    ],
  };
}
