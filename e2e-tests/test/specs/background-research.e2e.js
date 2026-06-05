import {
  clearChatTestState,
  clickButtonWithText,
  ensureChatUI,
  heldTextResponse,
  installAppFileStorageMock,
  installOpenRouterMock,
  releaseHeldOpenRouterResponse,
  sendMessage,
  textResponse,
  waitForHeldOpenRouterResponse,
  waitForOpenRouterStreamEvent,
  waitForText,
} from '../helpers/chat.js';

describe('Background Research', () => {
  beforeEach(async () => {
    await ensureChatUI();
    await installAppFileStorageMock();
  });

  afterEach(async () => {
    await clearChatTestState();
  });

  it('keeps a running search alive when switching app tabs', async () => {
    const releaseKey = 'tab-switch-background';
    const finalText = 'Tab switch background run completed.';

    await installOpenRouterMock([
      folderNameResponse('tab-switch-background'),
      heldTextResponse(finalText, releaseKey),
    ]);

    await sendMessage('Alpha background run');
    await waitForHeldOpenRouterResponse(releaseKey);

    await switchToAppTab('prompts');
    await releaseHeldOpenRouterResponse(releaseKey);

    await waitForOpenRouterStreamEvent(releaseKey, 'completed');
    expect(await streamWasCancelled(releaseKey)).toBe(false);

    await switchToAppTab('main');
    await waitForText(finalText);
  });

  it('keeps the first search running after starting a new search', async () => {
    const firstFolder = 'first-background-run';
    const firstReleaseKey = 'first-background-run';
    const firstFinalText = 'First background run completed.';
    const secondFinalText = 'Second background run completed.';

    await installOpenRouterMock([
      folderNameResponse(firstFolder),
      heldTextResponse(firstFinalText, firstReleaseKey),
      folderNameResponse('second-background-run'),
      textResponse(secondFinalText),
    ]);

    await sendMessage('First background run');
    await waitForHeldOpenRouterResponse(firstReleaseKey);

    await clickButtonWithText('New Chat');
    await sendMessage('Second background run');
    await waitForText(secondFinalText);

    expect(await streamWasCancelled(firstReleaseKey)).toBe(false);

    await releaseHeldOpenRouterResponse(firstReleaseKey);
    await waitForOpenRouterStreamEvent(firstReleaseKey, 'completed');
    await waitForResearchChatSaves(firstFolder, 2);
    expect(await streamWasCancelled(firstReleaseKey)).toBe(false);

    await selectResearchFolder(firstFolder);
    await waitForText(firstFinalText);
  });
});

function folderNameResponse(folderName) {
  return textResponse(JSON.stringify({ folderName }));
}

async function switchToAppTab(tabId) {
  const tab = await $(`[data-testid="app-tab"][data-tab-id="${tabId}"]`);
  await tab.waitForExist({ timeout: 5000 });
  await tab.click();
}

async function selectResearchFolder(folderName) {
  await browser.waitUntil(
    async () => {
      const buttons = await $$('nav[aria-label="Previous searches"] button[title]');
      for (const button of buttons) {
        if ((await button.getAttribute('title')) === folderName) {
          await button.click();
          return true;
        }
      }
      return false;
    },
    {
      timeout: 10000,
      interval: 250,
      timeoutMsg: `Expected research folder "${folderName}" in Previous Searches`,
    },
  );
}

async function streamWasCancelled(releaseKey) {
  return browser.execute(
    (key) =>
      (window.__logs || []).some(
        (entry) =>
          entry.kind === 'openrouter-stream' &&
          entry.releaseKey === key &&
          entry.event === 'cancelled',
      ),
    releaseKey,
  );
}

async function waitForResearchChatSaves(folderName, count) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        ({ folder, minimumCount }) =>
          (window.__deepSearchAppFileStorageLog || []).filter(
            (entry) =>
              entry.action === 'write' &&
              entry.subfolder === `search-results/${folder}/chats`,
          ).length >= minimumCount,
        { folder: folderName, minimumCount: count },
      ),
    {
      timeout: 10000,
      interval: 100,
      timeoutMsg: `Expected at least ${count} chat saves for "${folderName}"`,
    },
  );
}
