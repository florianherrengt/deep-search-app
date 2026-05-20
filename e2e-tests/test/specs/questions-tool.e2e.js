import {
  clearChatTestState,
  clickButtonWithText,
  ensureChatUI,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from '../helpers/chat.js';

describe('Questions Tool UI', () => {
  beforeEach(async () => {
    await ensureChatUI();
  });

  afterEach(async () => {
    await clearChatTestState();
  });

  it('should render questions with candidate buttons', async () => {
    await installQuestionMock();

    await sendMessage('What color?');
    await waitForText('Which color do you prefer?');
    await waitForText('Red');
    await waitForText('Blue');
  });

  it('should select a candidate and submit the answer', async () => {
    await installQuestionMock();

    await sendMessage('Pick a color');
    await waitForText('Red');
    await clickButtonWithText('Red');
    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');
    await waitForText('red');
  });

  it('should allow typing a custom answer', async () => {
    await installQuestionMock();

    await sendMessage('Pick a color');

    const customInput = await $('input[placeholder="Or type your own..."]');
    await customInput.waitForExist({ timeout: 10000 });
    await customInput.setValue('Green');

    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');
    await waitForText('Green');
  });

  it('should show model reply after submitting answers', async () => {
    await installQuestionMock([textResponse('Great choice')]);

    await sendMessage('Pick a color');
    await waitForText('Red');
    await clickButtonWithText('Red');
    await clickButtonWithText('Submit Answers');
    await waitForText('Answers submitted');
    await waitForText('Great choice');
  });
});

async function installQuestionMock(afterToolResponses = []) {
  await installOpenRouterMock([
    toolCallResponse('ask_questions', {
      questions: [
        {
          question: 'Which color do you prefer?',
          candidates: [
            { label: 'Red', value: 'red' },
            { label: 'Blue', value: 'blue' },
          ],
        },
      ],
    }),
    ...afterToolResponses,
  ]);
}
