import {
  clearChatTestState,
  clickButtonWithText,
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
      toolCallResponse('sequential_thinking', {
        thoughts: ['step 1', 'step 2'],
      }),
      textResponse('Here is my answer.'),
    ]);

    await sendMessage('Think about something');

    await waitForText('sequential_thinking');
    await waitForText('done');
    await waitForText('Here is my answer.');
  });

  it('shows a subagent card with running spinner while tool executes', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('I see the files.'),
    ]);

    await sendMessage('Show files');

    await waitForText('list_files');
    await waitForText('done');
    await waitForText('I see the files.');
  });

  it('opens the subagent sidebar from the toolbar', async () => {
    await installAppFileStorageMock({});
    await installOpenRouterMock([
      textResponse('Done.'),
    ]);

    await sendMessage('Research my topic');

    await waitForText('Done.');
    await openSubAgentSidebar();
    await waitForText('Folder Naming');

    const sidebar = await browser.waitUntil(
      async () => {
        const text = await $('body').getText();
        return text.includes('Sub-agents');
      },
      { timeout: 5000, interval: 200 },
    );

    expect(sidebar).toBeTruthy();
  });

  it('expands the inline tool detail panel', async () => {
    await installOpenRouterMock([
      toolCallResponse('list_files', {}),
      textResponse('All done.'),
    ]);

    await sendMessage('List files please');

    await waitForText('list_files');
    await waitForText('done');
    await waitForTextStreamCompleted();

    await clickButtonByAriaLabel('Expand list_files details');
    await waitForText('list_files');
  });

  it('shows multiple subagent cards for multiple tool calls', async () => {
    await installOpenRouterMock([
      toolCallResponse('sequential_thinking', { thoughts: ['step 1'] }),
      toolCallResponse('list_files', {}),
      textResponse('Done with everything.'),
    ]);

    await sendMessage('Do multiple things');

    await waitForText('sequential_thinking');
    await waitForText('list_files');
    await waitForText('Done with everything.');

    const bodyText = await $('body').getText();
    const stCount = (bodyText.match(/sequential_thinking/g) || []).length;
    expect(stCount).toBeGreaterThanOrEqual(1);

    const lfCount = (bodyText.match(/list_files/g) || []).length;
    expect(lfCount).toBeGreaterThanOrEqual(1);
  });

  it('shows the close button in the subagent sidebar', async () => {
    await installAppFileStorageMock({});
    await installOpenRouterMock([
      textResponse('Done.'),
    ]);

    await sendMessage('Research my topic');
    await waitForText('Done.');
    await openSubAgentSidebar();

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

    await waitForText('list_files');
    await waitForText('done');

    await openSubAgentSidebar();

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

    await waitForText('list_files');
    await waitForText('done');

    await openSubAgentSidebar();

    const bodyText = await $('body').getText();
    const hasMemory = bodyText.includes('Memory Extraction');
    expect(hasMemory).toBeTruthy();
  });
});

async function openSubAgentSidebar() {
  await clickButtonWithText('Sub agents');
  await waitForText('Sub-agents');
}

async function clickButtonByAriaLabel(label) {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedLabel) => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid="assistant-message"] button'),
        );
        const button = buttons.find((candidate) => {
          if (candidate.getAttribute('aria-label') !== expectedLabel) {
            return false;
          }
          const style = window.getComputedStyle(candidate);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            candidate.getClientRects().length > 0
          );
        });

        if (!button) return false;

        button.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        button.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, cancelable: true }),
        );
        button.click();
        return true;
      }, label),
    { timeout: 10000, interval: 200 },
  );

  if (label.startsWith('Expand ')) {
    const collapseLabel = label.replace(/^Expand /, 'Collapse ');
    await browser.waitUntil(
      async () =>
        browser.execute((expectedLabel) => {
          return Boolean(
            document.querySelector(
              `[data-testid="assistant-message"] button[aria-label="${expectedLabel}"]`,
            ),
          );
        }, collapseLabel),
      { timeout: 5000, interval: 100 },
    );
  }
}

async function waitForTextStreamCompleted() {
  await browser.waitUntil(
    async () =>
      browser.execute(() =>
        (window.__logs || []).some(
          (entry) =>
            entry.kind === 'openrouter-stream' &&
            entry.responseType === 'text' &&
            entry.event === 'completed',
        ),
      ),
    { timeout: 10000, interval: 100 },
  );
}
