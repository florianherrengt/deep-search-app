import {
  clearChatTestState,
  ensureChatUI,
  installAppFileStorageMock,
  installOpenRouterMock,
  installSearxngSearchMock,
  installTauriWebviewExtractionMock,
  releaseTauriWebviewExtractionMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForTauriWebviewExtractionMock,
  waitForText,
} from '../helpers/chat.js';

describe('Extraction Webview Tabs', () => {
  beforeEach(async () => {
    await ensureChatUI({ searxng_url: 'http://localhost:8080' });
    await installAppFileStorageMock();
    await installSearxngSearchMock();
  });

  afterEach(async () => {
    await clearChatTestState();
  });

  it('shows the extraction webview as a tab while extract_page_content is running', async () => {
    const url = 'https://example.com/e2e-webview-tab';

    await installTauriWebviewExtractionMock(`
      <html>
        <body>
          <main>
            <h1>Mock extraction page</h1>
            <p>Content returned from the mocked Tauri webview extraction.</p>
          </main>
        </body>
      </html>
    `);

    await installOpenRouterMock([
      toolCallResponse('searxng_search', {
        query: 'example page',
      }),
      toolCallResponse('extract_page_content', {
        url,
        summarize: false,
        method: 'webview',
      }),
      textResponse('Extraction complete'),
    ]);

    await sendMessage('Extract the example page');
    await waitForTauriWebviewExtractionMock();

    await waitForBrowserTab(url, true, {
      timeout: 15000,
      interval: 250,
      timeoutMsg: 'Expected extraction tab to appear while webview is open',
    });

    const activeVariant = await browser.execute((targetUrl) => {
      const tab = document.querySelector(
        `[data-testid="browser-tab"][data-tab-url="${targetUrl}"]`,
      );
      return tab?.getAttribute('data-variant') ?? null;
    }, url);
    expect(activeVariant).toBe('light');

    await releaseTauriWebviewExtractionMock();

    await waitForBrowserTab(url, false, {
      timeout: 15000,
      interval: 250,
      timeoutMsg: 'Expected extraction tab to close after webview extraction',
    });
    await waitForText('Extraction complete');

    const commands = await browser.execute(
      () => window.__deepSearchWebviewExtractionLog || [],
    );
    const commandNames = commands.map((entry) => entry.cmd);
    expect(commandNames.includes('open_tab')).toBe(true);
    expect(commandNames.includes('extract_content')).toBe(true);
    expect(commandNames.includes('close_tab')).toBe(true);
  });
});

async function browserTabExists(url) {
  return browser.execute(
    (targetUrl) =>
      Boolean(
        document.querySelector(
          `[data-testid="browser-tab"][data-tab-url="${targetUrl}"]`,
        ),
      ),
    url,
  );
}

async function waitForBrowserTab(url, expected, options) {
  try {
    await browser.waitUntil(
      async () => (await browserTabExists(url)) === expected,
      options,
    );
  } catch (error) {
    const debug = await browser.execute((targetUrl) => ({
      appTabs: Array.from(document.querySelectorAll('[data-testid="app-tab"]'))
        .map((tab) => ({
          id: tab.getAttribute('data-tab-id'),
          text: tab.textContent?.trim() ?? '',
          variant: tab.getAttribute('data-variant'),
        })),
      browserTabs: Array.from(
        document.querySelectorAll('[data-testid="browser-tab"]'),
      ).map((tab) => ({
        id: tab.getAttribute('data-tab-id'),
        url: tab.getAttribute('data-tab-url'),
        text: tab.textContent?.trim() ?? '',
        variant: tab.getAttribute('data-variant'),
      })),
      extractionLog: window.__deepSearchWebviewExtractionLog || [],
      browserErrors: window.__deepSearchBrowserErrors || [],
      bodyText: (document.body?.innerText || '').slice(0, 1000),
      targetUrl,
    }), url);
    throw new Error(
      `${options.timeoutMsg}. Debug: ${JSON.stringify(debug)}`,
      { cause: error },
    );
  }
}
