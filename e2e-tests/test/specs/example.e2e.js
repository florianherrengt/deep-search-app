import {
  clearChatTestState,
  ensureChatUI,
  waitForText,
} from '../helpers/chat.js';

describe('Deep Search App', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('should display the app title', async () => {
    await ensureChatUI();

    const header = await $('h1');
    await header.waitForExist({ timeout: 10000 });
    const text = await header.getText();
    expect(text).toBe('Deep Search');
  });

  it('should have a message input', async () => {
    await ensureChatUI();

    const textarea = await $('textarea');
    await textarea.waitForExist({ timeout: 10000 });
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBe('Ask something...');
  });

  it('should have the send button', async () => {
    await ensureChatUI();
    await waitForText('Send', 10000);
  });

  it('should have the welcome message', async () => {
    await ensureChatUI();
    await waitForText('Ask something...', 10000);
  });
});
