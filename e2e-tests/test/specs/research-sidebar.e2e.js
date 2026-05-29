import {
  clearChatTestState,
  ensureChatUI,
  installAppFileStorageMock,
  installOpenRouterMock,
  refreshResearchLibraryFromMock,
  sendMessage,
  textResponse,
  toolCallResponse,
} from '../helpers/chat.js';

describe('Research Sidebar', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('orders previous searches by latest saved chat update', async () => {
    await ensureChatUI();
    await installAppFileStorageMock({
      'search-results/older-topic/chats/2026-05-21T10-00-00.000Z.json':
        JSON.stringify(savedChat({
          id: '2026-05-21T10-00-00.000Z',
          title: 'Older topic',
          createdAt: '2026-05-21T10:00:00.000Z',
          updatedAt: '2026-05-21T10:30:00.000Z',
        })),
      'search-results/latest-topic/chats/2026-05-23T10-00-00.000Z.json':
        JSON.stringify(savedChat({
          id: '2026-05-23T10-00-00.000Z',
          title: 'Latest topic',
          createdAt: '2026-05-23T10:00:00.000Z',
          updatedAt: '2026-05-23T10:30:00.000Z',
        })),
    });

    await browser.waitUntil(
      async () => {
        await refreshResearchLibraryFromMock();
        const folders = await sidebarFolderTitles();
        return folders[0] === 'latest-topic' && folders[1] === 'older-topic';
      },
      {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'Expected latest-topic to appear above older-topic',
      },
    );
  });

  it('updates previous searches when a research file is saved', async () => {
    await ensureChatUI();
    await installAppFileStorageMock();

    await browser.waitUntil(
      async () => {
        await refreshResearchLibraryFromMock();
        const sidebar = await $('nav[aria-label="Previous searches"]');
        const text = await sidebar.getText();
        return text.includes('No searches yet');
      },
      {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'Expected Previous Searches to use mocked storage',
      },
    );

    const folderName = `e2e-sidebar-refresh-${Date.now()}`;
    const prompt = folderName.replace(/-/g, ' ');

    await installOpenRouterMock([
      toolCallResponse('save_research_file', {
        filename: 'notes.md',
        content: 'Saved from e2e test',
      }),
      textResponse(JSON.stringify({ folderName })),
      textResponse('Saved the research file.'),
    ]);

    await sendMessage(prompt);

    await browser.waitUntil(
      async () => {
        const logs = await browser.execute(() => window.__logs || []);
        return logs.length > 0;
      },
      {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'Expected mocked OpenRouter call to be used',
      },
    );

    await browser.waitUntil(
      async () => {
        const sidebar = await $('nav[aria-label="Previous searches"]');
        const text = await sidebar.getText();
        return text.includes(folderName);
      },
      {
        timeout: 15000,
        interval: 250,
        timeoutMsg: await sidebarFailureMessage(folderName),
      },
    );
  });
});

async function sidebarFailureMessage(folderName) {
  const writes = await browser.execute(
    () => window.__deepSearchAppFileStorageLog || [],
  );
  const calls = await browser.execute(() => window.__logs || []);
  return `Expected ${folderName} to appear in Previous Searches. Writes: ${JSON.stringify(
    writes,
  )}. LLM calls: ${JSON.stringify(calls)}`;
}

async function sidebarFolderTitles() {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(
        'nav[aria-label="Previous searches"] button[title]',
      ),
    ).map((button) => button.getAttribute('title')),
  );
}

function savedChat({ id, title, createdAt, updatedAt }) {
  return {
    id,
    title,
    createdAt,
    updatedAt,
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: title }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done' }],
      },
    ],
  };
}
