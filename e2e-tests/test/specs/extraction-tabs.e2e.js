import {
  clearChatTestState,
  ensureChatUI,
  installAppFileStorageMock,
  installOpenRouterMock,
  installTauriWebviewExtractionMock,
  releaseTauriWebviewExtractionMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from '../helpers/chat.js';

describe('Extraction Webview Tabs', () => {
  beforeEach(async () => {
    await ensureChatUI();
    await installAppFileStorageMock();
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
      toolCallResponse('extract_page_content', {
        url,
        summarize: false,
        method: 'webview',
      }),
      textResponse('Extraction complete'),
    ]);

    await sendMessage('Extract the example page');

    await browser.waitUntil(async () => browserTabExists(url), {
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
    expect(activeVariant).toBe('secondary');

    await releaseTauriWebviewExtractionMock();

    await browser.waitUntil(async () => !(await browserTabExists(url)), {
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
