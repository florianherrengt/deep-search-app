import {
  clearChatTestState,
  ensureChatUI,
  waitForText,
  clickButtonWithText,
} from '../helpers/chat.js';

async function switchToSkillsTab() {
  const tabs = await $$('[data-testid="app-tab"]');
  for (const tab of tabs) {
    const tabId = await tab.getAttribute('data-tab-id');
    if (tabId === 'skills') {
      await tab.click();
      return;
    }
  }
  throw new Error('Skills tab not found');
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

async function addSkill(title, whenToUse, content) {
  await clickButtonWithText('Add');

  const titleInput = await $('input[placeholder="Skill title"]');
  await titleInput.waitForExist({ timeout: 5000 });
  await titleInput.setValue(title);

  const whenInput = await $('input[placeholder="When should the AI load this skill?"]');
  await whenInput.setValue(whenToUse);

  const textarea = await $('textarea[placeholder="Skill instructions..."]');
  await textarea.setValue(content);

  await clickButtonWithText('Save');
  await waitForText(title, 5000);
}

describe('Skills', () => {
  afterEach(async () => {
    await clearChatTestState();
  });

  it('should show the Skills tab', async () => {
    await ensureChatUI();

    const tabs = await $$('[data-testid="app-tab"]');
    const tabTexts = [];
    for (const tab of tabs) {
      tabTexts.push(await tab.getText());
    }
    expect(tabTexts).toContain('Skills');
  });

  it('should show empty state when no skills exist', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await waitForText('No skills yet', 5000);
  });

  it('should add a skill and show it in the list', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await addSkill(
      'Expert Presenter',
      'Use when the user needs help with a presentation',
      'You are a presentation expert. Structure content into clear slides with key points.',
    );

    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Expert Presenter');
    expect(bodyText).toContain('expert-presenter');
    expect(bodyText).toContain('Use when the user needs help with a presentation');
  });

  it('should show the auto-generated slug while editing', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await clickButtonWithText('Add');

    const titleInput = await $('input[placeholder="Skill title"]');
    await titleInput.waitForExist({ timeout: 5000 });
    await titleInput.setValue('Data Analysis Wizard');

    await waitForText('slug: data-analysis-wizard', 5000);
  });

  it('should delete a skill', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await addSkill('ToDelete', 'When to delete', 'Delete this skill');

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

  it('should edit a skill', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await addSkill('Original', 'Original when to use', 'Original content');

    const editButtons = await $$('button[aria-label="Edit Original"]');
    expect(editButtons.length).toBe(1);
    await editButtons[0].click();

    const inputs = await $$('input');
    const titleInput = inputs[0];
    await titleInput.clearValue();
    await titleInput.setValue('Renamed Skill');

    const whenInput = inputs[1];
    await whenInput.clearValue();
    await whenInput.setValue('Updated trigger');

    const textarea = await $('textarea');
    await textarea.clearValue();
    await textarea.setValue('Updated content');

    await clickButtonWithText('Save');

    await waitForText('Renamed Skill', 5000);
    const bodyText = await $('body').getText();
    expect(bodyText).toContain('Updated trigger');
    expect(bodyText).toContain('renamed-skill');
    expect(bodyText).not.toContain('Original');
  });

  it('should validate required fields', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await clickButtonWithText('Add');

    const titleInput = await $('input[placeholder="Skill title"]');
    await titleInput.waitForExist({ timeout: 5000 });

    await clickButtonWithText('Save');

    await waitForText('Title is required', 5000);
  });

  it('should cancel adding a skill', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await clickButtonWithText('Add');

    const titleInput = await $('input[placeholder="Skill title"]');
    await titleInput.waitForExist({ timeout: 5000 });
    await titleInput.setValue('Cancelled Skill');

    await clickButtonWithText('Cancel');

    const bodyText = await $('body').getText();
    expect(bodyText).not.toContain('Cancelled Skill');
  });

  it('should persist skills after navigating away and back', async () => {
    await ensureChatUI();
    await switchToSkillsTab();

    await addSkill('Persistent', 'Always available', 'This skill persists');

    await switchToChatTab();
    await switchToSkillsTab();

    await waitForText('Persistent', 5000);
    const bodyText = await $('body').getText();
    expect(bodyText).toContain('persistent');
  });
});
