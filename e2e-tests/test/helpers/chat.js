export async function ensureChatUI() {
  await browser.refresh();
  await waitForText('Deep Search', 10000);
  await browser.execute(() => {
    window.localStorage.setItem(
      'deep-search-test-settings',
      JSON.stringify({
        chat_provider: 'openrouter',
        openrouter_api_key: 'test-key-123',
        anthropic_api_key: '',
        zhipu_api_key: '',
        zhipu_base_url: '',
        searxng_url: '',
        brave_api_key: '',
        exa_api_key: '',
        serper_api_key: '',
        tavily_api_key: '',
        default_model: 'openrouter/free',
        anthropic_model: 'claude-sonnet-4-5',
        zhipu_model: 'glm-4.7-flash',
      }),
    );
  });
  await browser.refresh();
  await $('textarea').waitForExist({ timeout: 10000 });
}

export async function clearChatTestState() {
  await browser.execute(() => {
    window.localStorage.removeItem('deep-search-test-settings');
    delete window.__deepSearchAppFileStorageMock;
    delete window.__deepSearchAppFileStorageLog;
    delete window.__deepSearchResearchSearchMock;
    delete window.__deepSearchProviderFetchMock;
    delete window.__logs;
  });
}

export async function installAppFileStorageMock(initialFiles = {}) {
  await browser.execute((files) => {
    const store = { ...files };
    window.__deepSearchAppFileStorageLog = [];

    window.__deepSearchAppFileStorageMock = {
      async writeAppFile({ subfolder, filename, content }) {
        window.__deepSearchAppFileStorageLog.push({
          action: 'write',
          subfolder,
          filename,
        });
        store[`${subfolder}/${filename}`] = content;
      },

      async readAppFile({ subfolder, filename }) {
        return store[`${subfolder}/${filename}`] ?? null;
      },

      async listAppSubfolders({ subfolder }) {
        const prefix = `${subfolder}/`;
        const names = new Set();

        for (const path of Object.keys(store)) {
          if (!path.startsWith(prefix)) continue;

          const rest = path.slice(prefix.length);
          const [name, ...remaining] = rest.split('/');
          if (name && remaining.length > 0) {
            names.add(name);
          }
        }

        return Array.from(names).sort((a, b) => a.localeCompare(b));
      },

      async listAppFiles({ subfolder }) {
        const prefix = `${subfolder}/`;

        return Object.keys(store)
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length))
          .filter((path) => path && !path.includes('/'))
          .sort((a, b) => a.localeCompare(b));
      },

      async deleteAppSubfolder({ subfolder }) {
        window.__deepSearchAppFileStorageLog.push({
          action: 'delete',
          subfolder,
        });
        const prefix = `${subfolder}/`;

        for (const path of Object.keys(store)) {
          if (path.startsWith(prefix)) {
            delete store[path];
          }
        }
      },

      async renameAppSubfolder({ oldSubfolder, newSubfolder }) {
        window.__deepSearchAppFileStorageLog.push({
          action: 'rename',
          oldSubfolder,
          newSubfolder,
        });
        const oldPrefix = `${oldSubfolder}/`;
        const moves = Object.entries(store).filter(([path]) =>
          path.startsWith(oldPrefix),
        );

        for (const [path, content] of moves) {
          delete store[path];
          store[`${newSubfolder}/${path.slice(oldPrefix.length)}`] = content;
        }
      },
    };

    window.__deepSearchResearchSearchMock = {
      async indexResearchFile() {},
      async registerResearchFolder() {
        return 1;
      },
    };
  }, initialFiles);
}

export async function refreshResearchLibraryFromMock() {
  await browser.execute(() => {
    window.dispatchEvent(
      new CustomEvent('research-library-changed', {
        detail: {
          changeType: 'write',
          folderName: '__e2e_refresh__',
        },
      }),
    );
  });
}

export async function sendMessage(text) {
  const textarea = await $('textarea');
  await textarea.setValue(text);

  await browser.waitUntil(
    async () => {
      const buttons = await $$('button');
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

export async function clickButtonWithText(text) {
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

export async function waitForText(text, timeout = 15000) {
  await browser.waitUntil(
    async () => {
      const bodyText = await $('body').getText();
      return bodyText.includes(text);
    },
    { timeout, interval: 500 },
  );
}

export async function installOpenRouterMock(responses) {
  await browser.execute((mockResponses) => {
    window.__logs = [];
    const originalFetch = window.fetch.bind(window);
    let callIndex = 0;

    const mockFetch = async (url, options) => {
      const href = typeof url === 'string' ? url : url?.url || String(url);
      if (!href.includes('openrouter')) {
        return originalFetch(url, options);
      }

      const response =
        mockResponses[Math.min(callIndex, mockResponses.length - 1)];
      callIndex += 1;
      window.__logs.push({
        kind: 'openrouter',
        callIndex,
        responseType: response.type,
      });
      return streamResponse(response.events);
    };

    window.fetch = mockFetch;
    window.__deepSearchProviderFetchMock = mockFetch;

    function streamResponse(events) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          events.forEach((event, index) => {
            setTimeout(() => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
              if (index === events.length - 1) {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              }
            }, (index + 1) * 25);
          });
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
  }, responses);
}

export function textResponse(content) {
  return {
    type: 'text',
    events: [
      {
        id: 'mock-text',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'mock-text',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
      {
        id: 'mock-text',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ],
  };
}

export function toolCallResponse(name, args) {
  return {
    type: 'tool',
    events: [
      {
        id: 'mock-tool',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${name}`,
                  type: 'function',
                  function: {
                    name,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'mock-tool',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ],
  };
}
