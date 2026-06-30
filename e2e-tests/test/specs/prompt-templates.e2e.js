import {
  clearChatTestState,
  ensureChatUI,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  waitForText,
  clickButtonWithText,
} from '../helpers/chat.js';

async function switchToPromptsTab() {
  const tabs = await $$('[data-testid="app-tab"]');
  for (const tab of tabs) {
    const tabId = await tab.getAttribute('data-tab-id');
    if (tabId === 'prompts') {
      await tab.click();
      return;
    }
  }
  throw new Error('Prompts tab not found');
}

async function switchToChatTab() {
  const tabs = await $$('[data-testid="app-tab"]');
  for (const tab of tabs) {
    const tabId = await tab.getAttribute('data-tab-id');
    if (tabId === 'main') {
      await tab.click();
      return;
    }
  }
  throw new Error('Chat tab not found');
}

async function addTemplate(name, text) {
  await clickButtonWithText('Add');

  const nameInput = await $('input[placeholder="Template name"]');
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue(name);

  const textarea = await $('textarea[placeholder="Enter prompt text..."]');
  await textarea.setValue(text);

  await clickButtonWithText('Save');
  await waitForText(name, 5000);
}

async function selectPromptTemplate(name) {
  await browser.waitUntil(
    async () => {
      const buttons = await $$('button[aria-label="Prompt templates"]');
      for (const button of buttons) {
        if (!(await button.isDisplayed())) continue;
        await button.click();
        return true;
      }
      return false;
    },
    { timeout: 5000, interval: 200 },
  );

  try {
    await browser.waitUntil(
      async () => {
        return browser.execute((templateName) => {
          const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
            .find(
              (candidate) =>
                candidate.textContent?.trim() === templateName &&
                candidate.getClientRects().length > 0,
            );
          if (!item) return false;
          item.click();
          return true;
        }, name);
      },
      { timeout: 5000, interval: 200 },
    );
  } catch (error) {
    const debug = await browser.execute(() => ({
      buttons: Array.from(
        document.querySelectorAll('button[aria-label="Prompt templates"]'),
      ).map((button) => ({
        text: button.textContent?.trim() ?? '',
        visible: button.getClientRects().length > 0,
        ariaExpanded: button.getAttribute('aria-expanded'),
      })),
      menuItems: Array.from(document.querySelectorAll('[role="menuitem"]')).map(
        (item) => ({
          text: item.textContent?.trim() ?? '',
          visible: item.getClientRects().length > 0,
        }),
      ),
      promptStore: window.__deepSearchStoreMockData?.['prompt-templates.json'],
    }));
    throw new Error(
      `Expected prompt template menu item "${name}". Debug: ${JSON.stringify(debug)}`,
      { cause: error },
    );
  }
}

async function deleteAllVisibleTemplates() {
  let attempts = 0;
  while (attempts < 20) {
    const deleteButtons = await $$('button[aria-label^="Delete "]');
    if (deleteButtons.length === 0) break;
    const btn = deleteButtons[deleteButtons.length - 1];
    if (!(await btn.isDisplayed())) break;
    await btn.click();
    await browser.pause(300);
    attempts += 1;
  }
}

describe('Prompt Templates', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('should show the Prompts tab', async () => {
    await ensureChatUI();

    const tabs = await $$('[data-testid="app-tab"]');
    const tabTexts = [];
    for (const tab of tabs) {
      tabTexts.push(await tab.getText());
    }
    expect(tabTexts).toContain('Prompts');
  });

  it('should add a template and show it in the list', async () => {
    await ensureChatUI();
    await switchToPromptsTab();

    await addTemplate('Test Prompt', 'This is a test prompt');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Test Prompt');
    expect(bodyText).toContain('This is a test prompt');
  });

  it('should add a template and show it in the chat template dropdown', async () => {
    await ensureChatUI();
    await switchToPromptsTab();

    await addTemplate('Quick Search', 'Search for information about');

    await switchToChatTab();

    await selectPromptTemplate('Quick Search');

    const textarea = await $('textarea[placeholder="Ask something..."]');
    await textarea.waitForExist({ timeout: 5000 });
    const value = await textarea.getValue();
    expect(value).toBe('Search for information about');
  });

  it('should populate composer when selecting a template from the dropdown', async () => {
    await ensureChatUI();
    await switchToPromptsTab();

    await addTemplate('Summarize', 'Summarize the following text');

    await switchToChatTab();
    await selectPromptTemplate('Summarize');

    const textarea = await $('textarea[placeholder="Ask something..."]');
    await textarea.waitForExist({ timeout: 5000 });
    const value = await textarea.getValue();
    expect(value).toBe('Summarize the following text');
  });

  it('should send template via main button click', async () => {
    await ensureChatUI();
    await switchToPromptsTab();
    await deleteAllVisibleTemplates();
    await browser.pause(500);

    await addTemplate('Hello', 'Say hello world');

    await switchToChatTab();

    await installOpenRouterMock([textResponse('Hello world response')]);

    await selectPromptTemplate('Hello');

    const textarea = await $('textarea[placeholder="Ask something..."]');
    await textarea.waitForExist({ timeout: 5000 });
    expect(await textarea.getValue()).toBe('Say hello world');

    await clickButtonWithText('Send');
    await waitForText('Hello world response', 10000);
  });

  it('should delete a template', async () => {
    await ensureChatUI();
    await switchToPromptsTab();

    await addTemplate('ToDelete', 'This will be deleted');

    const deleteButtons = await $$('button[aria-label="Delete ToDelete"]');
    expect(deleteButtons.length).toBe(1);
    await deleteButtons[0].click();

    await browser.waitUntil(
      async () => {
        const bodyText = await $('body').getText();
        return !bodyText.includes('ToDelete');
      },
      { timeout: 5000, interval: 200 },
    );
  });

  it('should edit a template', async () => {
    await ensureChatUI();
    await switchToPromptsTab();
    await deleteAllVisibleTemplates();
    await browser.pause(500);

    await addTemplate('Original', 'Original text');

    let editButton;
    await browser.waitUntil(
      async () => {
        const buttons = await $$('button[aria-label="Edit Original"]');
        if (buttons.length > 0 && await buttons[0].isDisplayed()) {
          editButton = buttons[0];
          return true;
        }
        return false;
      },
      { timeout: 5000, interval: 200 },
    );
    await editButton.click();

    const nameInput = await $('input[placeholder="Template name"]');
    await nameInput.waitForDisplayed({ timeout: 5000 });
    await nameInput.clearValue();
    await nameInput.setValue('Renamed');

    const textarea = await $('textarea[placeholder="Enter prompt text..."]');
    await textarea.waitForDisplayed({ timeout: 5000 });
    await textarea.clearValue();
    await textarea.setValue('Updated text');

    await clickButtonWithText('Save');

    await waitForText('Renamed', 5000);
    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Updated text');
    expect(bodyText).not.toContain('Original');
  });

  it('should show empty state when no templates exist', async () => {
    await ensureChatUI();
    await switchToPromptsTab();
    await deleteAllVisibleTemplates();
    await browser.pause(500);

    const bodyText = await $('body').getText();
    if (!bodyText.includes('No templates yet')) {
      await deleteAllVisibleTemplates();
      await browser.pause(500);
    }

    await waitForText('No templates yet', 10000);
  });
});
