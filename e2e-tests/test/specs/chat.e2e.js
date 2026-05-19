describe('Chat Flow', () => {
  async function ensureChatUI() {
    const input = await $('input[type="password"]');
    const hasKeyForm = await input.isExisting();
    if (hasKeyForm) {
      await input.setValue('test-key-123');
      const submitBtn = await $('main.container button[type="submit"]');
      await submitBtn.click();
    }

    const welcome = await $('.aui-welcome, .aui-viewport');
    await welcome.waitForExist({ timeout: 5000 });
  }

  it('should display the chat UI', async () => {
    await ensureChatUI();

    const h1 = await $('h1');
    await h1.waitForExist({ timeout: 5000 });
    const text = await h1.getText();
    expect(text).toBe('Deep Search');
  });

  it('should have a composer with input and send button', async () => {
    await ensureChatUI();

    const textarea = await $('.aui-composer-input');
    await textarea.waitForExist({ timeout: 5000 });
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBe('Ask something...');

    const sendBtn = await $('.aui-composer .aui-btn');
    await sendBtn.waitForExist({ timeout: 5000 });
    const text = await sendBtn.getText();
    expect(text).toBe('Send');
  });

  it('should send a message and display a mocked response', async () => {
    await ensureChatUI();

    await browser.execute(() => {
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (typeof url === 'string' && url.includes('openrouter')) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              const events = [
                '{"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
                '{"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello from test"},"finish_reason":null}]}',
                '{"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
              ];
              events.forEach((event, i) => {
                setTimeout(() => {
                  controller.enqueue(
                    encoder.encode('data: ' + event + '\n\n'),
                  );
                  if (i === events.length - 1) {
                    controller.enqueue(
                      encoder.encode('data: [DONE]\n\n'),
                    );
                    controller.close();
                  }
                }, (i + 1) * 200);
              });
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        return originalFetch(url, options);
      };
    });

    const textarea = await $('.aui-composer-input');
    await textarea.setValue('Hello');

    const sendBtn = await $('.aui-composer .aui-btn');
    await sendBtn.click();

    const userMsg = await $('.aui-msg-user');
    await userMsg.waitForExist({ timeout: 5000 });

    const assistantMsg = await $('.aui-msg-assistant');
    await assistantMsg.waitForExist({ timeout: 5000 });

    await browser.waitUntil(
      async () => {
        const text = await assistantMsg.getText();
        return text.includes('Hello from test');
      },
      { timeout: 10000, interval: 500 },
    );

    const text = await assistantMsg.getText();
    expect(text).toContain('Hello from test');
  });
});
