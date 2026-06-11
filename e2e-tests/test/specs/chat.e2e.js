import {
  clearChatTestState,
  ensureChatUI,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  waitForText,
} from '../helpers/chat.js';

describe('Chat Flow', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('should display the chat UI', async () => {
    await ensureChatUI();

    const h1 = await $('h1');
    await h1.waitForExist({ timeout: 5000 });
    const text = await h1.getText();
    expect(text).toBe('Deep Search');
  });

  it('should have a composer with input and send button', async () => {
    await ensureChatUI();

    const textarea = await $('textarea');
    await textarea.waitForExist({ timeout: 5000 });
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBe('Ask something...');

    await waitForText('Send', 5000);
  });

  it('should lay out sidebar and chat area side by side', async () => {
    await ensureChatUI();

    const sidebar = await $('[data-testid="research-sidebar"]');
    await sidebar.waitForExist({ timeout: 5000 });
    const textarea = await $('textarea');
    await textarea.waitForExist({ timeout: 5000 });

    const sidebarBox = await getElementRect(sidebar);
    const textareaBox = await getElementRect(textarea);

    expect(sidebarBox.right).toBeLessThan(textareaBox.left);
    expect(sidebarBox.y).toBeLessThanOrEqual(textareaBox.y + 10);
  });

  it('should send a message and display a mocked response', async () => {
    await ensureChatUI();
    await installOpenRouterMock([textResponse('Hello from test')]);

    await sendMessage('Hello');

    await waitForText('Hello');
    await waitForText('Hello from test');
  });
});

async function getElementRect(element) {
  return element.execute((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}
