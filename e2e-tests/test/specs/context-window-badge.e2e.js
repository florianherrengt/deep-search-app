import {
  clearChatTestState,
  ensureChatUI,
} from '../helpers/chat.js';

describe('Context Window Badge', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('should display the context window badge below the input', async () => {
    await ensureChatUI();

    const badge = await $('[data-testid="context-window-badge"]');
    await badge.waitForExist({ timeout: 5000 });

    const isDisplayed = await badge.isDisplayed();
    expect(isDisplayed).toBe(true);

    const text = await badge.getText();
    expect(text).toMatch(/^Context:/);
  });
});
