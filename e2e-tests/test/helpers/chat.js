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

    window.__deepSearchDisambiguateMock = async () => 'mocked disambiguation result';
    window.__deepSearchCurrencyMock = async (_from, _to, amount) => (amount * 1.1).toFixed(2);
    window.__deepSearchFetchHtmlMock = async () => null;
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
    delete window.__deepSearchOpenRouterReleases;
    delete window.__deepSearchWebviewExtractionMock;
    delete window.__deepSearchReleaseExtraction;
    delete window.__deepSearchWebviewExtractionLog;
    delete window.__deepSearchDisambiguateMock;
    delete window.__deepSearchCurrencyMock;
    delete window.__deepSearchFetchHtmlMock;
    delete window.__logs;
    delete window.__allFetchLogs;
  });
}

export async function clearPromptTemplates() {
  await browser.execute(async () => {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load('prompt-templates.json');
    await store.set('templates', []);
    await store.set('lastSelectedTemplate', null);
    await store.save();
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
      async searchResearch() {
        return [];
      },
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

export async function installTauriWebviewExtractionMock(html) {
  await browser.execute((mockHtml) => {
    window.__deepSearchWebviewExtractionLog = [];
    window.__deepSearchReleaseExtraction = null;

    window.__deepSearchWebviewExtractionMock = {
      async openTab(args) {
        window.__deepSearchWebviewExtractionLog.push({
          cmd: 'open_tab',
          args,
        });
      },
      async switchTab(args) {
        window.__deepSearchWebviewExtractionLog.push({
          cmd: 'switch_tab',
          args,
        });
      },
      async extractContent(args) {
        window.__deepSearchWebviewExtractionLog.push({
          cmd: 'extract_content',
          args,
        });
        await new Promise((resolve) => {
          window.__deepSearchReleaseExtraction = resolve;
        });
        return mockHtml;
      },
      async closeTab(args) {
        window.__deepSearchWebviewExtractionLog.push({
          cmd: 'close_tab',
          args,
        });
      },
    };
  }, html);
}

export async function releaseTauriWebviewExtractionMock() {
  await browser.waitUntil(
    async () =>
      browser.execute(
        () => typeof window.__deepSearchReleaseExtraction === 'function',
      ),
    {
      timeout: 10000,
      interval: 100,
      timeoutMsg: 'Expected mocked extraction to be waiting for release',
    },
  );

  await browser.execute(() => {
    window.__deepSearchReleaseExtraction();
  });
}

export async function waitForHeldOpenRouterResponse(releaseKey = 'default') {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (key) =>
          typeof window.__deepSearchOpenRouterReleases?.[key] === 'function',
        releaseKey,
      ),
    {
      timeout: 10000,
      interval: 100,
      timeoutMsg: `Expected held OpenRouter response "${releaseKey}" to be waiting for release`,
    },
  );
}

export async function releaseHeldOpenRouterResponse(releaseKey = 'default') {
  await waitForHeldOpenRouterResponse(releaseKey);

  await browser.execute((key) => {
    window.__deepSearchOpenRouterReleases[key]();
  }, releaseKey);
}

export async function waitForOpenRouterStreamEvent(
  releaseKey,
  event,
  timeout = 10000,
) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        ({ key, expectedEvent }) =>
          (window.__logs || []).some(
            (entry) =>
              entry.kind === 'openrouter-stream' &&
              entry.releaseKey === key &&
              entry.event === expectedEvent,
          ),
        { key: releaseKey, expectedEvent: event },
      ),
    {
      timeout,
      interval: 100,
      timeoutMsg: `Expected OpenRouter stream "${releaseKey}" event "${event}"`,
    },
  );
}

export async function sendMessage(text) {
  const textarea = await findVisibleTextarea();
  await textarea.setValue(text);

  await browser.waitUntil(
    async () => {
      const buttons = await $$('button');
      for (const btn of buttons) {
        if (!(await btn.isDisplayed())) continue;
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

async function findVisibleTextarea() {
  await browser.waitUntil(
    async () => {
      const textareas = await $$('textarea');
      for (const textarea of textareas) {
        if (await textarea.isDisplayed()) {
          return true;
        }
      }
      return false;
    },
    {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Expected a visible chat composer textarea',
    },
  );

  const textareas = await $$('textarea');
  for (const textarea of textareas) {
    if (await textarea.isDisplayed()) {
      return textarea;
    }
  }

  throw new Error('Visible chat composer textarea not found');
}

export async function clickButtonWithText(text) {
  await browser.waitUntil(
    async () => {
      const buttons = await $$('button');
      for (const btn of buttons) {
        if (!(await btn.isDisplayed())) continue;
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
    window.__deepSearchOpenRouterReleases = {};
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
        releaseKey: response.releaseKey ?? null,
      });
      return streamResponse(response, callIndex);
    };

    window.fetch = mockFetch;
    window.__deepSearchProviderFetchMock = mockFetch;

    function streamResponse(response, callIndex) {
      const encoder = new TextEncoder();
      const events = response.events;
      const releaseKey = response.releaseKey ?? null;
      const holdAfterEventIndex =
        Number.isInteger(response.holdAfterEventIndex)
          ? response.holdAfterEventIndex
          : null;
      const eventDelayMs = response.eventDelayMs ?? 25;
      let cancelled = false;
      let completed = false;
      const timers = [];

      function log(event) {
        window.__logs.push({
          kind: 'openrouter-stream',
          callIndex,
          responseType: response.type,
          releaseKey,
          event,
        });
      }

      function clearTimers() {
        for (const timer of timers) {
          clearTimeout(timer);
        }
        timers.length = 0;
      }

      function clearRelease() {
        if (releaseKey) {
          delete window.__deepSearchOpenRouterReleases[releaseKey];
        }
      }

      const stream = new ReadableStream({
        start(controller) {
          log('started');

          const enqueueEvent = (event) => {
            if (cancelled || completed) return;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };

          const finish = () => {
            if (cancelled || completed) return;

            completed = true;
            clearRelease();
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            log('completed');
          };

          const schedule = (fn, delay) => {
            const timer = setTimeout(() => {
              const index = timers.indexOf(timer);
              if (index !== -1) {
                timers.splice(index, 1);
              }
              fn();
            }, delay);
            timers.push(timer);
          };

          const emitEvents = (startIndex, endIndex, onDone) => {
            if (startIndex > endIndex) {
              onDone();
              return;
            }

            for (let index = startIndex; index <= endIndex; index += 1) {
              schedule(() => {
                enqueueEvent(events[index]);
                if (index === endIndex) {
                  onDone();
                }
              }, (index - startIndex + 1) * eventDelayMs);
            }
          };

          const emitRemainingAndFinish = () => {
            emitEvents(
              (holdAfterEventIndex ?? -1) + 1,
              events.length - 1,
              finish,
            );
          };

          if (releaseKey && holdAfterEventIndex !== null) {
            emitEvents(0, holdAfterEventIndex, () => {
              if (cancelled || completed) return;

              log('waiting');
              window.__deepSearchOpenRouterReleases[releaseKey] = () => {
                if (cancelled || completed) return;

                clearRelease();
                log('released');
                emitRemainingAndFinish();
              };
            });
          } else {
            emitEvents(0, events.length - 1, finish);
          }
        },
        cancel() {
          if (completed) return;

          cancelled = true;
          clearTimers();
          clearRelease();
          log('cancelled');
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

export function heldTextResponse(content, releaseKey = 'default') {
  return {
    ...textResponse(content),
    type: 'held-text',
    releaseKey,
    holdAfterEventIndex: 0,
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
