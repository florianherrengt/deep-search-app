import {
  clearChatTestState,
  ensureChatUI,
  installAppFileStorageMock,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from '../helpers/chat.js';

describe('Subagent Visibility', () => {
  beforeEach(async () => {
    await ensureChatUI();
  });

  afterEach(async () => {
    await clearChatTestState();
  });

  it('shows a subagent card in the chat when a tool is called', async () => {
    await installOpenRouterMock([
      textResponse('Let me search for that.'),
      toolCallResponse('sequential_thinking', {
        thoughts: ['step 1', 'step 2'],
      }),
      textResponse('Here is my answer.'),
    ]);

    await sendMessage('Think about something');

    await waitForText('Sequential Thinking');
    await waitForText('done');
    await waitForText('Here is my answer.');
  });

  it('shows a subagent card with running spinner while tool executes', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('I see the files.'),
    ]);

    await sendMessage('Show files');

    await waitForText('List Files');
    await waitForText('done');
    await waitForText('I see the files.');
  });

  it('opens the right sidebar when clicking a subagent card', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('Done.'),
    ]);

    await sendMessage('List my files');

    await waitForText('List Files');
    await waitForText('done');

    const card = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label && label.startsWith('Inspect')) {
            return btn;
          }
        }
        return false;
      },
      { timeout: 10000, interval: 200 },
    );

    await card.click();

    await waitForText('Subagents');
    await waitForText('List Files');

    const sidebar = await browser.waitUntil(
      async () => {
        const text = await $('body').getText();
        return text.includes('Subagents');
      },
      { timeout: 5000, interval: 200 },
    );

    expect(sidebar).toBeTruthy();
  });

  it('shows tool call input and result in the sidebar detail panel', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('All done.'),
    ]);

    await sendMessage('List files please');

    await waitForText('List Files');
    await waitForText('done');

    const card = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label && label.startsWith('Inspect')) {
            return btn;
          }
        }
        return false;
      },
      { timeout: 10000, interval: 200 },
    );

    await card.click();

    await waitForText('Subagents');

    await waitForText('Tool Calls');
  });

  it('shows multiple subagent cards for multiple tool calls', async () => {
    await installOpenRouterMock([
      toolCallResponse('sequential_thinking', { thoughts: ['step 1'] }),
      toolCallResponse('list_files', {}),
      textResponse('Done with everything.'),
    ]);

    await sendMessage('Do multiple things');

    await waitForText('Sequential Thinking');
    await waitForText('List Files');
    await waitForText('Done with everything.');

    const bodyText = await $('body').getText();
    const stCount = (bodyText.match(/Sequential Thinking/g) || []).length;
    expect(stCount).toBeGreaterThanOrEqual(1);

    const lfCount = (bodyText.match(/List Files/g) || []).length;
    expect(lfCount).toBeGreaterThanOrEqual(1);
  });

  it('shows the close button in the subagent sidebar', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('Done.'),
    ]);

    await sendMessage('Show files');

    await waitForText('List Files');
    await waitForText('done');

    const card = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label && label.startsWith('Inspect')) {
            return btn;
          }
        }
        return false;
      },
      { timeout: 10000, interval: 200 },
    );

    await card.click();

    await waitForText('Subagents');

    const closeBtn = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label === 'Close subagent sidebar') {
            return btn;
          }
        }
        return false;
      },
      { timeout: 5000, interval: 200 },
    );

    expect(closeBtn).toBeTruthy();
  });

  it('shows Folder Naming subagent in sidebar for first message', async () => {
    await installAppFileStorageMock({});
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('Here are the files.'),
    ]);

    await sendMessage('Research my topic');

    await waitForText('List Files');
    await waitForText('done');

    const card = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label && label.startsWith('Inspect')) {
            return btn;
          }
        }
        return false;
      },
      { timeout: 10000, interval: 200 },
    );

    await card.click();

    await waitForText('Subagents');

    const bodyText = await $('body').getText();
    const hasFolderNaming = bodyText.includes('Folder Naming');
    expect(hasFolderNaming).toBeTruthy();
  });

  it('shows Memory Extraction subagent in sidebar', async () => {
    await installAppFileStorageMock({});
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('Done.'),
    ]);

    await sendMessage('Remember that I prefer dark mode');

    await waitForText('List Files');
    await waitForText('done');

    const card = await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          if (!(await btn.isDisplayed())) continue;
          const label = await btn.getAttribute('aria-label');
          if (label && label.startsWith('Inspect')) {
            return btn;
          }
        }
        return false;
      },
      { timeout: 10000, interval: 200 },
    );

    await card.click();

    await waitForText('Subagents');

    const bodyText = await $('body').getText();
    const hasMemory = bodyText.includes('Memory Extraction');
    expect(hasMemory).toBeTruthy();
  });
});
