describe('Questions Tool UI', () => {
  beforeEach(async () => {
    await browser.refresh();
    await browser.waitUntil(
      async () => {
        const el = await $('textarea, input[type="password"]');
        return el.isExisting();
      },
      { timeout: 10000, interval: 500 },
    );
  });

  async function ensureChatUI() {
    const input = await $('input[type="password"]');
    const hasKeyForm = await input.isExisting();
    if (hasKeyForm) {
      await input.setValue('test-key-123');
      const submitBtn = await $('main button[type="submit"]');
      await submitBtn.click();
    }

    const textarea = await $('textarea');
    await textarea.waitForExist({ timeout: 5000 });
  }

  async function sendMessage(text) {
    const textarea = await $('textarea');
    await textarea.setValue(text);

    await browser.waitUntil(
      async () => {
        const buttons = await $$('form button');
        for (const btn of buttons) {
          const btnText = await btn.getText();
          const disabled = await btn.getAttribute('disabled');
          if (btnText === 'Send' && disabled === null) {
            await btn.click();
            return true;
          }
        }
        return false;
      },
      { timeout: 5000, interval: 200 },
    );
  }

  async function clickButtonWithText(text) {
    await browser.waitUntil(
      async () => {
        const buttons = await $$('button');
        for (const btn of buttons) {
          const btnText = await btn.getText();
          if (btnText === text) {
            await btn.click();
            return true;
          }
        }
        return false;
      },
      { timeout: 5000, interval: 200 },
    );
  }

  async function waitForText(text, timeout = 10000) {
    await browser.waitUntil(
      async () => {
        const bodyText = await $('body').getText();
        return bodyText.includes(text);
      },
      { timeout, interval: 500 },
    );
  }

  it('should render questions with candidate buttons', async () => {
    await ensureChatUI();

    await browser.execute(() => {
      window.__mockQuestions = true;
    });

    await sendMessage('What color?');
    await waitForText('Which color do you prefer?');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Red');
    expect(bodyText).toContain('Blue');
  });

  it('should select a candidate and submit the answer', async () => {
    await ensureChatUI();

    await browser.execute(() => {
      window.__mockQuestions = true;
    });

    await sendMessage('Pick a color');
    await waitForText('Red');
    await clickButtonWithText('Red');
    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('red');
  });

  it('should allow typing a custom answer', async () => {
    await ensureChatUI();

    await browser.execute(() => {
      window.__mockQuestions = true;
    });

    await sendMessage('Pick a color');

    await browser.waitUntil(
      async () => {
        const inputs = await $$('input[placeholder="Or type your own..."]');
        return inputs.length > 0;
      },
      { timeout: 10000, interval: 500 },
    );

    const customInput = await $('input[placeholder="Or type your own..."]');
    await customInput.setValue('Green');

    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Green');
  });

  it('should show model reply after submitting answers', async () => {
    await ensureChatUI();

    await browser.execute(() => {
      window.__mockQuestions = true;
    });

    await sendMessage('Pick a color');
    await waitForText('Red');
    await clickButtonWithText('Red');
    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');
    await browser.pause(5000);

    const debug = await browser.execute(() => ({
      bodyText: document.body.innerText.substring(0, 3000),
      bodyHTML: document.body.innerHTML.substring(0, 5000),
      mockFlag: window.__mockQuestions,
      logs: (window.__logs || []),
    }));
    console.log('DEBUG:', JSON.stringify(debug).substring(0, 8000));
    expect(debug.bodyText).toContain('Great choice');
  });
});
