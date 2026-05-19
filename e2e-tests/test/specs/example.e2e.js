describe('Deep Search App', () => {
  it('should display the app title', async () => {
    const header = await $('h1');
    await header.waitForExist({ timeout: 10000 });
    const text = await header.getText();
    expect(text).toBe('Deep Search');
  });

  it('should have a message input', async () => {
    const textarea = await $('textarea[name="input"]');
    await textarea.waitForExist({ timeout: 10000 });
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBe('Ask something...');
  });

  it('should have a disabled send button', async () => {
    const button = await $('form.aui-composer button');
    await button.waitForExist({ timeout: 10000 });
    const text = await button.getText();
    const disabled = await button.getAttribute('disabled');
    expect(text).toBe('Send');
    expect(disabled).not.toBeNull();
  });

  it('should have the welcome message', async () => {
    const welcome = await $('.aui-welcome p');
    await welcome.waitForExist({ timeout: 10000 });
    const text = await welcome.getText();
    expect(text).toBe('Ask something...');
  });
});
