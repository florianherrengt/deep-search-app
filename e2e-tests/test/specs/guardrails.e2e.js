import {
  clearChatTestState,
  ensureChatUI,
  installOpenRouterMock,
  sendMessage,
  textResponse,
  toolCallResponse,
  waitForText,
} from '../helpers/chat.js';

describe('Visible Agent Guardrails', () => {
  beforeEach(async () => {
    await ensureChatUI();
  });

  afterEach(async () => {
    await clearChatTestState();
  });

  it('shows a visible card and reroutes plain-text questions into ask_questions', async () => {
    await installOpenRouterMock([
      textResponse('Which color do you prefer?'),
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
    ]);

    await sendMessage('Pick a color');

    await waitForText('Question tool enforced');
    await waitForText('Prompted the agent to ask this with the question tool.');
    await waitForText('Which color do you prefer?');
    await waitForText('Red');
    await waitForText('Blue');

    const logs = await browser.execute(() => window.__logs || []);
    expect(logs.filter((entry) => entry.kind === 'openrouter')).toHaveLength(3);
  });

  it('shows a visible research-depth reminder and checkpoint guidance path', async () => {
    await installOpenRouterMock([
      textResponse('The current Acme Search price is about 10 pounds.'),
      toolCallResponse('research_checkpoint', {
        originalQuestion: 'Find the latest pricing for Acme Search',
        searchesRun: [],
        sourcesOpened: [],
        claimsVerified: [],
        unresolvedQuestions: ['No sources opened yet'],
        confidence: 'low',
        readyToAnswer: false,
      }),
      textResponse('I need to continue researching before answering.'),
    ]);

    await sendMessage('Find the latest pricing for Acme Search');

    await waitForText('Research depth reminder');
    await waitForText('Prompted the agent to consider whether more research is needed.');
    await waitForText('research_checkpoint');

    const logs = await browser.execute(() => window.__logs || []);
    expect(
      logs.filter((entry) => entry.kind === 'openrouter').length,
    ).toBeGreaterThanOrEqual(3);
  });
});
