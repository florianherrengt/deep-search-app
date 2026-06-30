export async function ensureChatUI(settingsOverrides = {}) {
  await browser.refresh();
  await waitForText('Deep Search', 10000);
  await browser.execute((overrides) => {
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
        ...overrides,
      }),
    );

  }, settingsOverrides);
  await browser.refresh();
  await $('textarea').waitForExist({ timeout: 10000 });
  await browser.execute(() => {
    window.__deepSearchDisambiguateMock = async () => 'mocked disambiguation result';
    window.__deepSearchCurrencyMock = async (_from, _to, amount) => (amount * 1.1).toFixed(2);
    window.__deepSearchFetchHtmlMock = async () => null;
  });
  await installBridgeMockDefaults();
}

export async function clearChatTestState() {
  await browser.execute(() => {
    window.localStorage.removeItem('deep-search-test-settings');
    window.localStorage.removeItem('deep-search:composer-draft');
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('deep-search:store:')) {
        window.localStorage.removeItem(key);
      }
    }
    delete window.__deepSearchAppFileStorageMock;
    delete window.__deepSearchAppFileStorageLog;
    delete window.__deepSearchResearchSearchMock;
    delete window.__deepSearchProviderFetchMock;
    delete window.__deepSearchOpenRouterReleases;
    delete window.__deepSearchBridgeMock;
    delete window.__deepSearchBridgeFileStore;
    delete window.__deepSearchBridgeDirectories;
    delete window.__deepSearchStoreMockData;
    delete window.__deepSearchBrowserErrors;
    delete window.__deepSearchBrowserErrorListenersInstalled;
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

export async function installBridgeMockDefaults(initialFiles = null) {
  await browser.execute((files) => {
    const existingBridgeMock = window.__deepSearchBridgeMock || {};

    if (files !== null || !window.__deepSearchBridgeFileStore) {
      window.__deepSearchBridgeFileStore = { ...(files || {}) };
      window.__deepSearchBridgeDirectories = [];
      for (const path of Object.keys(window.__deepSearchBridgeFileStore)) {
        addParentDirectories(path);
      }
    }

    window.__deepSearchAppFileStorageLog ||= [];
    window.__deepSearchStoreMockData ||= {};
    window.__deepSearchBrowserErrors ||= [];
    if (!window.__deepSearchBrowserErrorListenersInstalled) {
      window.addEventListener('error', (event) => {
        window.__deepSearchBrowserErrors.push({
          type: 'error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__deepSearchBrowserErrors.push({
          type: 'unhandledrejection',
          message: event.reason?.message || String(event.reason),
          stack: event.reason?.stack || null,
        });
      });
      window.__deepSearchBrowserErrorListenersInstalled = true;
    }

    function normalizePath(path) {
      return String(path || '')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    }

    function directorySet() {
      return new Set(window.__deepSearchBridgeDirectories || []);
    }

    function saveDirectories(dirs) {
      window.__deepSearchBridgeDirectories = Array.from(dirs).sort((a, b) => a.localeCompare(b));
    }

    function addDirectory(path) {
      const normalized = normalizePath(path);
      if (!normalized) return;
      const dirs = directorySet();
      const segments = normalized.split('/');
      for (let i = 1; i <= segments.length; i += 1) {
        dirs.add(segments.slice(0, i).join('/'));
      }
      saveDirectories(dirs);
    }

    function addParentDirectories(path) {
      const normalized = normalizePath(path);
      const parent = normalized.split('/').slice(0, -1).join('/');
      addDirectory(parent);
    }

    function splitPath(path) {
      const normalized = normalizePath(path);
      const parts = normalized.split('/');
      const filename = parts.pop() || '';
      return { subfolder: parts.join('/'), filename };
    }

    async function invoke(cmd, args = {}) {
      if (cmd === 'search_research') {
        return window.__deepSearchResearchSearchMock?.searchResearch?.(args) ?? [];
      }
      if (cmd === 'search_research_with_diagnostics') {
        return { results: [], diagnostics: [] };
      }
      if (cmd === 'index_research_file') {
        return window.__deepSearchResearchSearchMock?.indexResearchFile?.(args);
      }
      if (cmd === 'register_research_folder') {
        return window.__deepSearchResearchSearchMock?.registerResearchFolder?.(args) ?? 1;
      }
      if (cmd === 'fetch_html') {
        return window.__deepSearchFetchHtmlMock?.(args.url) ?? null;
      }
      if (cmd === 'open_tab') {
        return window.__deepSearchWebviewExtractionMock?.openTab?.(args);
      }
      if (cmd === 'switch_tab') {
        return window.__deepSearchWebviewExtractionMock?.switchTab?.(args);
      }
      if (cmd === 'extract_content') {
        return window.__deepSearchWebviewExtractionMock?.extractContent?.(args) ?? '';
      }
      if (cmd === 'close_tab') {
        return window.__deepSearchWebviewExtractionMock?.closeTab?.(args);
      }
      return undefined;
    }

    async function loadStore(filename, options = {}) {
      const stores = window.__deepSearchStoreMockData;
      stores[filename] ||= { ...(options.defaults || {}) };
      const data = stores[filename];

      return {
        get: async (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
        set: async (key, value) => {
          data[key] = value;
        },
        entries: async () => Object.entries(data),
        clear: async () => {
          for (const key of Object.keys(data)) {
            delete data[key];
          }
        },
        save: async () => undefined,
      };
    }

    async function writeTextFile(path, content) {
      const normalized = normalizePath(path);
      window.__deepSearchBridgeFileStore[normalized] = content;
      addParentDirectories(normalized);
      const { subfolder, filename } = splitPath(normalized);
      window.__deepSearchAppFileStorageLog.push({
        action: 'write',
        subfolder,
        filename,
      });
    }

    async function readTextFile(path) {
      return window.__deepSearchBridgeFileStore[normalizePath(path)] ?? '';
    }

    async function exists(path) {
      const normalized = normalizePath(path);
      const store = window.__deepSearchBridgeFileStore;
      const dirs = directorySet();
      if (!normalized) return true;
      if (Object.prototype.hasOwnProperty.call(store, normalized)) return true;
      if (dirs.has(normalized)) return true;
      const prefix = `${normalized}/`;
      return Object.keys(store).some((file) => file.startsWith(prefix));
    }

    async function readDir(path) {
      const normalized = normalizePath(path);
      const prefix = normalized ? `${normalized}/` : '';
      const entries = new Map();
      const dirs = directorySet();

      for (const dir of dirs) {
        if (dir === normalized || !dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) {
          entries.set(name, { name, isDirectory: true, isFile: false });
        }
      }

      for (const file of Object.keys(window.__deepSearchBridgeFileStore)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const parts = rest.split('/');
        const name = parts[0];
        if (!name) continue;
        if (parts.length > 1) {
          entries.set(name, { name, isDirectory: true, isFile: false });
        } else if (!entries.has(name)) {
          entries.set(name, { name, isDirectory: false, isFile: true });
        }
      }

      return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    async function remove(path, opts = {}) {
      const normalized = normalizePath(path);
      const prefix = `${normalized}/`;
      const store = window.__deepSearchBridgeFileStore;
      if (opts.recursive) {
        for (const file of Object.keys(store)) {
          if (file === normalized || file.startsWith(prefix)) {
            delete store[file];
          }
        }
        const dirs = directorySet();
        for (const dir of Array.from(dirs)) {
          if (dir === normalized || dir.startsWith(prefix)) {
            dirs.delete(dir);
          }
        }
        saveDirectories(dirs);
      } else {
        delete store[normalized];
      }
      window.__deepSearchAppFileStorageLog.push({ action: 'delete', subfolder: normalized });
    }

    async function rename(oldPath, newPath) {
      const oldNormalized = normalizePath(oldPath);
      const newNormalized = normalizePath(newPath);
      const oldPrefix = `${oldNormalized}/`;
      const store = window.__deepSearchBridgeFileStore;

      if (Object.prototype.hasOwnProperty.call(store, oldNormalized)) {
        store[newNormalized] = store[oldNormalized];
        delete store[oldNormalized];
      }

      for (const file of Object.keys(store)) {
        if (file.startsWith(oldPrefix)) {
          store[`${newNormalized}/${file.slice(oldPrefix.length)}`] = store[file];
          delete store[file];
        }
      }

      const dirs = directorySet();
      for (const dir of Array.from(dirs)) {
        if (dir === oldNormalized || dir.startsWith(oldPrefix)) {
          dirs.delete(dir);
          dirs.add(dir === oldNormalized ? newNormalized : `${newNormalized}/${dir.slice(oldPrefix.length)}`);
        }
      }
      saveDirectories(dirs);
      addParentDirectories(newNormalized);
      window.__deepSearchAppFileStorageLog.push({
        action: 'rename',
        oldSubfolder: oldNormalized,
        newSubfolder: newNormalized,
      });
    }

    async function mkdir(path) {
      addDirectory(path);
    }

    window.__deepSearchBridgeMock = {
      fetch: existingBridgeMock.fetch || ((input, init) => globalThis.fetch(input, init)),
      invoke: existingBridgeMock.invoke || invoke,
      loadStore: existingBridgeMock.loadStore || loadStore,
      writeTextFile,
      readTextFile,
      exists,
      readDir,
      remove,
      rename,
      mkdir,
      appDataDir: existingBridgeMock.appDataDir || (async () => '/tmp/deep-search-e2e'),
      join: existingBridgeMock.join || (async (...paths) => paths.join('/')),
      openUrl: existingBridgeMock.openUrl || (async () => undefined),
      openPath: existingBridgeMock.openPath || (async () => undefined),
      setupMenu: existingBridgeMock.setupMenu || (async () => undefined),
      sendNotification: existingBridgeMock.sendNotification || (() => undefined),
      checkForUpdate: existingBridgeMock.checkForUpdate || (async () => null),
      relaunchApp: existingBridgeMock.relaunchApp || (async () => undefined),
    };
  }, initialFiles);
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
  await installBridgeMockDefaults(initialFiles);
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

export async function installSearxngSearchMock(
  results = [
    {
      title: 'Example result',
      url: 'https://example.com/e2e-webview-tab',
      content: 'Mock search result from SearXNG',
    },
  ],
) {
  await installBridgeMockDefaults();
  await browser.execute((mockResults) => {
    const existingBridgeMock = window.__deepSearchBridgeMock || {};
    const existingFetch =
      existingBridgeMock.fetch || ((input, init) => globalThis.fetch(input, init));

    async function fetch(input, init) {
      const href = typeof input === 'string' ? input : input?.url || String(input);
      if (href.includes('localhost:8080')) {
        return new Response(JSON.stringify({ results: mockResults }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return existingFetch(input, init);
    }

    window.__deepSearchBridgeMock = {
      ...existingBridgeMock,
      fetch,
    };
  }, results);
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
        await new Promise((resolve) => {
          window.__deepSearchReleaseExtraction = resolve;
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

export async function releaseTauriWebviewExtractionMock(timeout = 20000) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        () => typeof window.__deepSearchReleaseExtraction === 'function',
      ),
    {
      timeout,
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
        const disabled = await btn.getAttribute('disabled');
        const ariaDisabled = await btn.getAttribute('aria-disabled');
        const enabled = await btn.isEnabled();
        if (
          btnText === text &&
          enabled &&
          disabled === null &&
          ariaDisabled !== 'true'
        ) {
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
  try {
    await browser.waitUntil(
      async () => {
        const bodyText = await getPageText();
        return bodyText.includes(text);
      },
      { timeout, interval: 500 },
    );
  } catch (error) {
    const [bodyText, logs, browserErrors] = await Promise.all([
      getPageText().catch(() => ''),
      browser.execute(() => window.__logs || []).catch(() => []),
      browser.execute(() => window.__deepSearchBrowserErrors || []).catch(() => []),
    ]);
    throw new Error(
      `Expected text "${text}" within ${timeout}ms. Body: ${bodyText.slice(0, 1000)}. OpenRouter logs: ${JSON.stringify(logs)}. Browser errors: ${JSON.stringify(browserErrors)}`,
      { cause: error },
    );
  }
}

async function getPageText() {
  return browser.execute(
    () => document.body?.innerText || document.body?.textContent || '',
  );
}

export async function installOpenRouterMock(responses) {
  await browser.execute((mockResponses) => {
    window.__logs = [];
    window.__deepSearchOpenRouterReleases = {};
    const bridgeFetch = window.__deepSearchBridgeMock?.fetch;
    const originalFetch =
      typeof bridgeFetch === 'function'
        ? bridgeFetch
        : window.fetch.bind(window);
    let callIndex = 0;
    let streamResponseIndex = 0;

    const mockFetch = async (url, options) => {
      const href = typeof url === 'string' ? url : url?.url || String(url);
      if (!href.includes('openrouter')) {
        return originalFetch(url, options);
      }

      const requestBody = await parseRequestBody(url, options?.body);
      callIndex += 1;

      if (requestBody && requestBody.stream !== true) {
        const content = nonStreamingContent(requestBody);
        window.__logs.push({
          kind: 'openrouter',
          callIndex,
          responseType: 'non-stream-text',
          releaseKey: null,
        });
        return jsonTextResponse(content);
      }

      const internalResponse = internalStreamResponse(requestBody);
      if (internalResponse) {
        window.__logs.push({
          kind: 'openrouter',
          callIndex,
          responseType: internalResponse.type,
          releaseKey: null,
        });
        return streamResponse(internalResponse, callIndex);
      }

      let response =
        mockResponses[Math.min(streamResponseIndex, mockResponses.length - 1)];
      streamResponseIndex += 1;
      const forcedToolName = getForcedToolName(requestBody);
      if (
        forcedToolName &&
        (response.type === 'text' || response.type === 'held-text')
      ) {
        response = forcedToolResponse(response, forcedToolName, requestBody);
      }
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
    window.__deepSearchBridgeMock = {
      ...(window.__deepSearchBridgeMock || {}),
      fetch: mockFetch,
    };

    async function parseRequestBody(input, body) {
      const raw =
        typeof body === 'string'
          ? body
          : typeof Request !== 'undefined' && input instanceof Request
            ? await input.clone().text()
            : null;
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function nonStreamingContent(body) {
      const text = requestText(body);
      const serialized = JSON.stringify(body || {});

      if (
        serialized.includes('You name research folders') ||
        serialized.includes('folder-naming tool')
      ) {
        return slugifyFolderName(text);
      }

      if (serialized.includes('Memory Extraction') || serialized.includes('memories')) {
        return '[]';
      }

      if (serialized.includes('research checkpoint')) {
        return 'Continue researching if more evidence would materially improve the answer.';
      }

      return 'OK';
    }

    function internalStreamResponse(body) {
      const content = internalModelContent(body);
      return content
        ? { type: content.type, events: textResponseEvents(content.text, content.type) }
        : null;
    }

    function internalModelContent(body) {
      const text = requestText(body);
      const serialized = JSON.stringify(body || {});

      if (serialized.includes('folder-naming tool')) {
        return { type: 'folder-name', text: slugifyFolderName(text) };
      }

      if (
        serialized.includes('Memory Extraction Agent') ||
        serialized.includes('memory extraction agent') ||
        serialized.includes('existing memories stored about the user')
      ) {
        return { type: 'memory-json', text: '[]' };
      }

      if (serialized.includes('research checkpoint')) {
        return {
          type: 'checkpoint-guidance',
          text: 'Continue researching if more evidence would materially improve the answer.',
        };
      }

      return null;
    }

    function requestText(body) {
      if (!body || typeof body !== 'object') return 'e2e research';
      const messages = Array.isArray(body.messages) ? body.messages : [];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          return contentText(messages[i].content) || 'e2e research';
        }
      }
      return contentText(body.prompt) || 'e2e research';
    }

    function contentText(content) {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map(contentText).filter(Boolean).join(' ');
      }
      if (content && typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.content === 'string') return content.content;
      }
      return '';
    }

    function slugifyFolderName(text) {
      const words = String(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8);

      return words.join('-') || 'e2e-research';
    }

    function getForcedToolName(body) {
      const choice = body?.tool_choice ?? body?.toolChoice;
      if (!choice || choice === 'auto' || choice === 'none') return null;
      if (choice === 'required') return 'research_checkpoint';
      if (typeof choice === 'string') return null;

      const functionName = choice.function?.name ?? choice.functionName;
      if (typeof functionName === 'string' && functionName) {
        return functionName;
      }

      const toolName = choice.toolName ?? choice.name;
      return typeof toolName === 'string' && toolName ? toolName : null;
    }

    function forcedToolResponse(sourceResponse, toolName, requestBody) {
      const response = {
        ...toolCallResponseEvents(toolName, defaultToolArgs(toolName, requestBody)),
        type: sourceResponse.releaseKey ? `held-${toolName}` : `forced-${toolName}`,
        ...(sourceResponse.releaseKey
          ? { releaseKey: sourceResponse.releaseKey }
          : {}),
        ...(Number.isInteger(sourceResponse.holdAfterEventIndex)
          ? { holdAfterEventIndex: sourceResponse.holdAfterEventIndex }
          : {}),
        ...(sourceResponse.eventDelayMs
          ? { eventDelayMs: sourceResponse.eventDelayMs }
          : {}),
      };

      if (sourceResponse.releaseKey) {
        delete sourceResponse.releaseKey;
        delete sourceResponse.holdAfterEventIndex;
        if (sourceResponse.type === 'held-text') {
          sourceResponse.type = 'text';
        }
      }

      return response;
    }

    function defaultToolArgs(toolName, requestBody) {
      if (toolName === 'ask_questions') {
        return {
          questions: [
            {
              question: 'Which option should I use?',
              candidates: [{ label: 'Default', value: 'default' }],
            },
          ],
        };
      }

      if (toolName === 'research_checkpoint') {
        return {
          originalQuestion: requestText(requestBody),
          searchesRun: [],
          sourcesOpened: [],
          claimsVerified: [],
          unresolvedQuestions: ['E2E mock supplied checkpoint input.'],
          confidence: 'low',
          readyToAnswer: false,
        };
      }

      return {};
    }

    function toolCallResponseEvents(name, args) {
      return {
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

    function textResponseEvents(content, id = 'mock-text') {
      return [
        {
          id,
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
          id,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        },
        {
          id,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ];
    }

    function jsonTextResponse(content) {
      return new Response(
        JSON.stringify({
          id: 'mock-non-stream',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

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

          const emitEventsNow = (startIndex, endIndex, onDone) => {
            if (startIndex > endIndex) {
              onDone();
              return;
            }

            for (let index = startIndex; index <= endIndex; index += 1) {
              enqueueEvent(events[index]);
            }
            onDone();
          };

          const emitRemainingAndFinish = () => {
            emitEventsNow(
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
            emitEventsNow(0, events.length - 1, finish);
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
