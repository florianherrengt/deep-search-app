import { expect, type Locator, type Page } from "@playwright/test";

export const CHAT_COMPOSER_INPUT_SELECTOR = '[data-testid="chat-composer-input"]';
export const CHAT_SEND_BUTTON_SELECTOR = '[data-testid="chat-send-button"]';

const TEST_SETTINGS_KEY = "deep-search-test-settings";
const BROWSER_FS_KEY = "deep-search:browser-fs";

export const TEST_SETTINGS = {
  chat_provider: "openrouter",
  openrouter_api_key: "",
  anthropic_api_key: "",
  deepseek_api_key: "",
  zhipu_api_key: "",
  zhipu_base_url: "",
  opencode_zen_api_key: "",
  local_api_key: "",
  local_base_url: "",
  local_model: "openai/gpt-oss-20b",
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  youtube_api_key: "",
  youtube_ytdlp_path: "",
  youtube_whisper_api_url: "",
  youtube_whisper_api_key: "",
  youtube_whisper_model: "whisper-1",
  scrape_do_api_key: "",
  default_model: "openrouter/auto",
  anthropic_model: "claude-sonnet-4-5",
  deepseek_model: "deepseek-chat",
  zhipu_model: "glm-4.7-flash",
  opencode_zen_model: "anthropic/claude-sonnet-4-5",
  currency: "USD",
  chrome_devtools_mcp_enabled: false,
  chrome_devtools_mcp_connection_mode: "auto",
  chrome_devtools_mcp_browser_url: "",
  chrome_devtools_mcp_node_path: "",
  web_extraction_backend: "tauri-webview",
  zoom_level: 1,
};

export type TestSettings = typeof TEST_SETTINGS;
export type TestSettingsOverride = Partial<TestSettings>;

type MockResponse = {
  type: string;
  events: unknown[];
  releaseKey?: string;
  holdAfterEventIndex?: number;
  eventDelayMs?: number;
};

type SearchResult = {
  title: string;
  url: string;
  content: string;
};

export async function setupMockedAppPage(
  page: Page,
  settings: TestSettingsOverride = {},
) {
  await page.addInitScript(
    ({ baseSettings, settingsOverride }) => {
      const win = window as any;
      const mergedSettings = { ...baseSettings, ...settingsOverride };
      if (!window.localStorage.getItem("deep-search-test-settings")) {
        window.localStorage.setItem(
          "deep-search-test-settings",
          JSON.stringify(mergedSettings),
        );
      }

      installBridgeMockDefaultsInBrowser(null);
      win.__deepSearchDisambiguateMock = async () => "mocked disambiguation result";
      win.__deepSearchCurrencyMock = async (_from: string, _to: string, amount: number) =>
        (amount * 1.1).toFixed(2);
      win.__deepSearchFetchHtmlMock = async () => null;

      function installBridgeMockDefaultsInBrowser(initialFiles: Record<string, string> | null) {
        const existingBridgeMock = win.__deepSearchBridgeMock || {};
        if (initialFiles !== null || !window.localStorage.getItem("deep-search:browser-fs")) {
          seedBrowserFs(initialFiles || {});
        }

        win.__deepSearchAppFileStorageLog ||= [];
        win.__deepSearchBrowserErrors ||= [];
        if (!win.__deepSearchBrowserErrorListenersInstalled) {
          window.addEventListener("error", (event) => {
            win.__deepSearchBrowserErrors.push({
              type: "error",
              message: event.message,
              filename: event.filename,
              lineno: event.lineno,
              colno: event.colno,
            });
          });
          window.addEventListener("unhandledrejection", (event) => {
            win.__deepSearchBrowserErrors.push({
              type: "unhandledrejection",
              message: event.reason?.message || String(event.reason),
              stack: event.reason?.stack || null,
            });
          });
          win.__deepSearchBrowserErrorListenersInstalled = true;
        }

        async function invoke(cmd: string, args: Record<string, unknown> = {}) {
          if (cmd === "search_research") {
            return win.__deepSearchResearchSearchMock?.searchResearch?.(args) ?? [];
          }
          if (cmd === "search_research_with_diagnostics") {
            return { results: [], diagnostics: [] };
          }
          if (cmd === "index_research_file") {
            return win.__deepSearchResearchSearchMock?.indexResearchFile?.(args);
          }
          if (cmd === "register_research_folder") {
            return win.__deepSearchResearchSearchMock?.registerResearchFolder?.(args) ?? 1;
          }
          if (cmd === "fetch_html") {
            return win.__deepSearchFetchHtmlMock?.(args.url) ?? null;
          }
          if (cmd === "open_tab") {
            return win.__deepSearchWebviewExtractionMock?.openTab?.(args);
          }
          if (cmd === "switch_tab") {
            return win.__deepSearchWebviewExtractionMock?.switchTab?.(args);
          }
          if (cmd === "extract_content") {
            return win.__deepSearchWebviewExtractionMock?.extractContent?.(args) ?? "";
          }
          if (cmd === "close_tab") {
            return win.__deepSearchWebviewExtractionMock?.closeTab?.(args);
          }
          return undefined;
        }

        async function writeTextFile(path: string, content: string, opts?: { append?: boolean }) {
          writeBrowserFile(path, content, Boolean(opts?.append));
          const { subfolder, filename } = splitPath(path);
          win.__deepSearchAppFileStorageLog.push({
            action: "write",
            subfolder,
            filename,
          });
        }

        win.__deepSearchBridgeMock = {
          fetch: existingBridgeMock.fetch || ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
          invoke: existingBridgeMock.invoke || invoke,
          writeTextFile,
          appDataDir: existingBridgeMock.appDataDir || (async () => "/tmp/deep-search-e2e"),
          join: existingBridgeMock.join || (async (...paths: string[]) => normalizePath(paths.join("/"))),
          openUrl: existingBridgeMock.openUrl || (async () => undefined),
          openPath: existingBridgeMock.openPath || (async () => undefined),
          setupMenu: existingBridgeMock.setupMenu || (async () => undefined),
          sendNotification: existingBridgeMock.sendNotification || (() => undefined),
          checkForUpdate: existingBridgeMock.checkForUpdate || (async () => null),
          relaunchApp: existingBridgeMock.relaunchApp || (async () => undefined),
        };

        win.__deepSearchInstallBridgeMockDefaults = installBridgeMockDefaultsInBrowser;
      }

      function seedBrowserFs(files: Record<string, string>) {
        const fs = { files: {} as Record<string, string>, dirs: [] as string[] };
        for (const [path, content] of Object.entries(files)) {
          const normalized = normalizePath(path);
          fs.files[normalized] = content;
          ensureBrowserDir(fs, parentPath(normalized));
        }
        writeBrowserFs(fs);
      }

      function writeBrowserFile(path: string, content: string, append: boolean) {
        const normalized = normalizePath(path);
        const fs = readBrowserFs();
        ensureBrowserDir(fs, parentPath(normalized));
        fs.files[normalized] = append ? `${fs.files[normalized] ?? ""}${content}` : content;
        writeBrowserFs(fs);
      }

      function readBrowserFs() {
        try {
          const raw = window.localStorage.getItem("deep-search:browser-fs");
          if (!raw) return { files: {}, dirs: [] as string[] };
          const parsed = JSON.parse(raw);
          return {
            files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
            dirs: Array.isArray(parsed.dirs) ? parsed.dirs : [],
          };
        } catch {
          return { files: {}, dirs: [] as string[] };
        }
      }

      function writeBrowserFs(fs: { files: Record<string, string>; dirs: string[] }) {
        fs.dirs = [...new Set(fs.dirs.map(normalizePath).filter(Boolean))].sort();
        window.localStorage.setItem("deep-search:browser-fs", JSON.stringify(fs));
      }

      function ensureBrowserDir(fs: { dirs: string[] }, path: string) {
        const normalized = normalizePath(path);
        if (!normalized) return;
        const parts = normalized.split("/");
        for (let i = 1; i <= parts.length; i += 1) {
          const dir = parts.slice(0, i).join("/");
          if (!fs.dirs.includes(dir)) fs.dirs.push(dir);
        }
      }

      function parentPath(path: string) {
        const normalized = normalizePath(path);
        const index = normalized.lastIndexOf("/");
        return index === -1 ? "" : normalized.slice(0, index);
      }

      function splitPath(path: string) {
        const normalized = normalizePath(path);
        const parts = normalized.split("/");
        const filename = parts.pop() || "";
        return { subfolder: parts.join("/"), filename };
      }

      function normalizePath(path: string) {
        return String(path || "")
          .split("/")
          .map((part) => part.trim())
          .filter((part) => part.length > 0 && part !== ".")
          .join("/");
      }
    },
    { baseSettings: TEST_SETTINGS, settingsOverride: settings },
  );

  await page.goto("/");
  await waitForAppReady(page);
}

export async function ensureChatUI(
  page: Page,
  settingsOverrides: TestSettingsOverride = {},
) {
  const settings = { ...TEST_SETTINGS, ...settingsOverrides };
  await page.evaluate(
    ({ key, nextSettings }) => {
      window.localStorage.setItem(key, JSON.stringify(nextSettings));
    },
    { key: TEST_SETTINGS_KEY, nextSettings: settings },
  );
  await page.reload();
  await waitForAppReady(page);
  await installBridgeMockDefaults(page);
}

export async function clearChatTestState(page: Page) {
  await page.evaluate(
    ({ settingsKey, fsKey }) => {
      const win = window as any;
      window.localStorage.removeItem(settingsKey);
      window.localStorage.removeItem("deep-search:composer-draft");
      window.localStorage.removeItem(fsKey);
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("deep-search:store:")) {
          window.localStorage.removeItem(key);
        }
      }
      delete win.__deepSearchAppFileStorageLog;
      delete win.__deepSearchResearchSearchMock;
      delete win.__deepSearchProviderFetchMock;
      delete win.__deepSearchOpenRouterReleases;
      delete win.__deepSearchBridgeMock;
      delete win.__deepSearchBrowserErrors;
      delete win.__deepSearchBrowserErrorListenersInstalled;
      delete win.__deepSearchWebviewExtractionMock;
      delete win.__deepSearchReleaseExtraction;
      delete win.__deepSearchWebviewExtractionLog;
      delete win.__deepSearchDisambiguateMock;
      delete win.__deepSearchCurrencyMock;
      delete win.__deepSearchFetchHtmlMock;
      delete win.__logs;
      delete win.__allFetchLogs;
    },
    { settingsKey: TEST_SETTINGS_KEY, fsKey: BROWSER_FS_KEY },
  );
}

export async function installBridgeMockDefaults(
  page: Page,
  initialFiles: Record<string, string> | null = null,
) {
  await page.evaluate((files) => {
    const win = window as any;
    win.__deepSearchInstallBridgeMockDefaults?.(files);
  }, initialFiles);
}

export async function installAppFileStorageMock(
  page: Page,
  initialFiles: Record<string, string> = {},
) {
  await installBridgeMockDefaults(page, initialFiles);
  await page.evaluate(() => {
    const win = window as any;
    win.__deepSearchAppFileStorageLog = [];
    win.__deepSearchResearchSearchMock = {
      async searchResearch() {
        return [];
      },
      async indexResearchFile() {},
      async registerResearchFolder() {
        return 1;
      },
    };
  });
}

export async function installSearxngSearchMock(
  page: Page,
  results: SearchResult[] = [
    {
      title: "Example result",
      url: "https://example.com/e2e-webview-tab",
      content: "Mock search result from SearXNG",
    },
  ],
) {
  await installBridgeMockDefaults(page);
  await page.evaluate((mockResults) => {
    const win = window as any;
    const existingBridgeMock = win.__deepSearchBridgeMock || {};
    const existingFetch =
      existingBridgeMock.fetch || ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

    async function fetch(input: RequestInfo | URL, init?: RequestInit) {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
      if (href.includes("localhost:8080")) {
        return new Response(JSON.stringify({ results: mockResults }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return existingFetch(input, init);
    }

    win.__deepSearchBridgeMock = {
      ...existingBridgeMock,
      fetch,
    };
  }, results);
}

export async function refreshResearchLibraryFromMock(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("research-library-changed", {
        detail: {
          changeType: "write",
          folderName: "__e2e_refresh__",
        },
      }),
    );
  });
}

export async function installTauriWebviewExtractionMock(page: Page, html: string) {
  await page.evaluate((mockHtml) => {
    const win = window as any;
    win.__deepSearchWebviewExtractionLog = [];
    win.__deepSearchReleaseExtraction = null;

    win.__deepSearchWebviewExtractionMock = {
      async openTab(args: unknown) {
        win.__deepSearchWebviewExtractionLog.push({
          cmd: "open_tab",
          args,
        });
        await new Promise((resolve) => {
          win.__deepSearchReleaseExtraction = resolve;
        });
      },
      async switchTab(args: unknown) {
        win.__deepSearchWebviewExtractionLog.push({
          cmd: "switch_tab",
          args,
        });
      },
      async extractContent(args: unknown) {
        win.__deepSearchWebviewExtractionLog.push({
          cmd: "extract_content",
          args,
        });
        return mockHtml;
      },
      async closeTab(args: unknown) {
        win.__deepSearchWebviewExtractionLog.push({
          cmd: "close_tab",
          args,
        });
      },
    };
  }, html);
}

export async function releaseTauriWebviewExtractionMock(page: Page, timeout = 20000) {
  await waitForTauriWebviewExtractionMock(page, timeout);

  await page.evaluate(() => {
    const win = window as any;
    win.__deepSearchReleaseExtraction();
  });
}

export async function waitForTauriWebviewExtractionMock(page: Page, timeout = 20000) {
  try {
    await page.waitForFunction(
      () => typeof (window as any).__deepSearchReleaseExtraction === "function",
      undefined,
      { timeout, polling: 100 },
    );
  } catch (error) {
    const debug = await page.evaluate(() => {
      const win = window as any;
      return {
        openRouterLogs: win.__logs || [],
        extractionLog: win.__deepSearchWebviewExtractionLog || [],
        browserErrors: win.__deepSearchBrowserErrors || [],
        bodyText: (document.body?.innerText || "").slice(0, 1000),
        testSettings: (() => {
          try {
            return JSON.parse(
              window.localStorage.getItem("deep-search-test-settings") || "null",
            );
          } catch {
            return null;
          }
        })(),
      };
    });
    throw new Error(
      `Expected mocked extraction to be waiting for release. Debug: ${JSON.stringify(debug)}`,
      { cause: error },
    );
  }
}

export async function waitForHeldOpenRouterResponse(
  page: Page,
  releaseKey = "default",
) {
  await page.waitForFunction(
    (key) => typeof (window as any).__deepSearchOpenRouterReleases?.[key] === "function",
    releaseKey,
    { timeout: 10000, polling: 100 },
  );
}

export async function releaseHeldOpenRouterResponse(
  page: Page,
  releaseKey = "default",
) {
  await waitForHeldOpenRouterResponse(page, releaseKey);

  await page.evaluate((key) => {
    const win = window as any;
    win.__deepSearchOpenRouterReleases[key]();
  }, releaseKey);
}

export async function waitForOpenRouterStreamEvent(
  page: Page,
  releaseKey: string,
  event: string,
  timeout = 10000,
) {
  await page.waitForFunction(
    ({ key, expectedEvent }) =>
      ((window as any).__logs || []).some(
        (entry: any) =>
          entry.kind === "openrouter-stream" &&
          entry.releaseKey === key &&
          entry.event === expectedEvent,
      ),
    { key: releaseKey, expectedEvent: event },
    { timeout, polling: 100 },
  );
}

export async function installOpenRouterMock(page: Page, responses: MockResponse[]) {
  await page.evaluate((mockResponses) => {
    const win = window as any;
    win.__logs = [];
    win.__deepSearchOpenRouterReleases = {};
    const bridgeFetch = win.__deepSearchBridgeMock?.fetch;
    const originalFetch =
      typeof bridgeFetch === "function"
        ? bridgeFetch
        : window.fetch.bind(window);
    let callIndex = 0;
    let streamResponseIndex = 0;

    const mockFetch = async (url: RequestInfo | URL, options?: RequestInit) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : String(url);
      if (!href.includes("openrouter")) {
        return originalFetch(url, options);
      }

      const requestBody = await parseRequestBody(url, options?.body);
      callIndex += 1;

      if (requestBody && requestBody.stream !== true) {
        const content = nonStreamingContent(requestBody);
        win.__logs.push({
          kind: "openrouter",
          callIndex,
          responseType: "non-stream-text",
          releaseKey: null,
        });
        return jsonTextResponse(content);
      }

      const internalResponse = internalStreamResponse(requestBody);
      if (internalResponse) {
        win.__logs.push({
          kind: "openrouter",
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
        (response.type === "text" || response.type === "held-text")
      ) {
        response = forcedToolResponse(response, forcedToolName, requestBody);
      }
      win.__logs.push({
        kind: "openrouter",
        callIndex,
        responseType: response.type,
        releaseKey: response.releaseKey ?? null,
      });
      return streamResponse(response, callIndex);
    };

    window.fetch = mockFetch;
    win.__deepSearchProviderFetchMock = mockFetch;
    win.__deepSearchBridgeMock = {
      ...(win.__deepSearchBridgeMock || {}),
      fetch: mockFetch,
    };

    async function parseRequestBody(input: RequestInfo | URL, body: BodyInit | null | undefined) {
      const raw =
        typeof body === "string"
          ? body
          : typeof Request !== "undefined" && input instanceof Request
            ? await input.clone().text()
            : null;
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    function nonStreamingContent(body: any) {
      const text = requestText(body);
      const serialized = JSON.stringify(body || {});

      if (
        serialized.includes("You name research folders") ||
        serialized.includes("folder-naming tool")
      ) {
        return slugifyFolderName(text);
      }

      if (serialized.includes("Memory Extraction") || serialized.includes("memories")) {
        return "[]";
      }

      if (serialized.includes("research checkpoint")) {
        return "Continue researching if more evidence would materially improve the answer.";
      }

      return "OK";
    }

    function internalStreamResponse(body: any) {
      const content = internalModelContent(body);
      return content
        ? { type: content.type, events: textResponseEvents(content.text, content.type) }
        : null;
    }

    function internalModelContent(body: any) {
      const text = requestText(body);
      const serialized = JSON.stringify(body || {});

      if (serialized.includes("folder-naming tool")) {
        return { type: "folder-name", text: slugifyFolderName(text) };
      }

      if (
        serialized.includes("Memory Extraction Agent") ||
        serialized.includes("existing memories stored about the user")
      ) {
        return { type: "memory-json", text: "[]" };
      }

      if (serialized.includes("research checkpoint")) {
        return {
          type: "checkpoint-guidance",
          text: "Continue researching if more evidence would materially improve the answer.",
        };
      }

      return null;
    }

    function requestText(body: any) {
      if (!body || typeof body !== "object") return "e2e research";
      const messages = Array.isArray(body.messages) ? body.messages : [];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === "user") {
          return contentText(messages[i].content) || "e2e research";
        }
      }
      return contentText(body.prompt) || "e2e research";
    }

    function contentText(content: any): string {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map(contentText).filter(Boolean).join(" ");
      }
      if (content && typeof content === "object") {
        if (typeof content.text === "string") return content.text;
        if (typeof content.content === "string") return content.content;
      }
      return "";
    }

    function slugifyFolderName(text: string) {
      const words = String(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8);

      return words.join("-") || "e2e-research";
    }

    function getForcedToolName(body: any) {
      const choice = body?.tool_choice ?? body?.toolChoice;
      if (!choice || choice === "auto" || choice === "none") return null;
      if (choice === "required") return "research_checkpoint";
      if (typeof choice === "string") return null;

      const functionName = choice.function?.name ?? choice.functionName;
      if (typeof functionName === "string" && functionName) {
        return functionName;
      }

      const toolName = choice.toolName ?? choice.name;
      return typeof toolName === "string" && toolName ? toolName : null;
    }

    function forcedToolResponse(sourceResponse: MockResponse, toolName: string, requestBody: any) {
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
        if (sourceResponse.type === "held-text") {
          sourceResponse.type = "text";
        }
      }

      return response;
    }

    function defaultToolArgs(toolName: string, requestBody: any) {
      if (toolName === "ask_questions") {
        return {
          questions: [
            {
              question: "Which option should I use?",
              candidates: [{ label: "Default", value: "default" }],
            },
          ],
        };
      }

      if (toolName === "research_checkpoint") {
        return {
          originalQuestion: requestText(requestBody),
          searchesRun: [],
          sourcesOpened: [],
          claimsVerified: [],
          unresolvedQuestions: ["E2E mock supplied checkpoint input."],
          confidence: "low",
          readyToAnswer: false,
        };
      }

      return {};
    }

    function toolCallResponseEvents(name: string, args: unknown) {
      return {
        events: [
          {
            id: "mock-tool",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${name}`,
                      type: "function",
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
            id: "mock-tool",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          },
        ],
      };
    }

    function textResponseEvents(content: string, id = "mock-text") {
      return [
        {
          id,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        },
        {
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        },
        {
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ];
    }

    function jsonTextResponse(content: string) {
      return new Response(
        JSON.stringify({
          id: "mock-non-stream",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
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
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    function streamResponse(response: MockResponse, callIndex: number) {
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
      const timers: number[] = [];

      function log(event: string) {
        win.__logs.push({
          kind: "openrouter-stream",
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
          delete win.__deepSearchOpenRouterReleases[releaseKey];
        }
      }

      const stream = new ReadableStream({
        start(controller) {
          log("started");

          const enqueueEvent = (event: unknown) => {
            if (cancelled || completed) return;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };

          const finish = () => {
            if (cancelled || completed) return;

            completed = true;
            clearRelease();
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            log("completed");
          };

          const schedule = (fn: () => void, delay: number) => {
            const timer = window.setTimeout(() => {
              const index = timers.indexOf(timer);
              if (index !== -1) {
                timers.splice(index, 1);
              }
              fn();
            }, delay);
            timers.push(timer);
          };

          const emitEvents = (startIndex: number, endIndex: number, onDone: () => void) => {
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

          const emitEventsNow = (startIndex: number, endIndex: number, onDone: () => void) => {
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

              log("waiting");
              win.__deepSearchOpenRouterReleases[releaseKey] = () => {
                if (cancelled || completed) return;

                clearRelease();
                log("released");
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
          log("cancelled");
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
  }, responses);
}

export function textResponse(content: string): MockResponse {
  return {
    type: "text",
    events: [
      {
        id: "mock-text",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "mock-text",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
      {
        id: "mock-text",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ],
  };
}

export function heldTextResponse(content: string, releaseKey = "default"): MockResponse {
  return {
    ...textResponse(content),
    type: "held-text",
    releaseKey,
    holdAfterEventIndex: 0,
  };
}

export function toolCallResponse(name: string, args: unknown): MockResponse {
  return {
    type: "tool",
    events: [
      {
        id: "mock-tool",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${name}`,
                  type: "function",
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
        id: "mock-tool",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
    ],
  };
}

export async function sendMessage(page: Page, text: string) {
  const textarea = getComposerInput(page);
  await textarea.fill(text);
  await clickComposerSend(page);
}

export function getComposerInput(page: Page): Locator {
  return page.locator(CHAT_COMPOSER_INPUT_SELECTOR);
}

export async function clickComposerSend(page: Page) {
  const button = page.locator(CHAT_SEND_BUTTON_SELECTOR);
  await expect(button).toBeVisible({ timeout: 10000 });
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
}

export async function waitForAppReady(page: Page, timeout = 10000) {
  await expect(page.locator('[data-testid="app-tab"][data-tab-id="main"]')).toBeVisible({
    timeout,
  });
  await expect(page.locator('[data-testid="app-tab"][data-tab-id="prompts"]')).toBeVisible({
    timeout,
  });
  await expect(page.locator(CHAT_COMPOSER_INPUT_SELECTOR)).toBeVisible({ timeout });
  await expect(page.locator(CHAT_SEND_BUTTON_SELECTOR)).toBeVisible({ timeout });
}

export async function clickAppTab(page: Page, tabId: string) {
  const tab = page.locator(`[data-testid="app-tab"][data-tab-id="${tabId}"]`);
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
  await expect(tab).toHaveAttribute("data-active", "true", { timeout: 10000 });
  await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 10000 });
}

export async function clickButtonWithText(page: Page, text: string) {
  await page.getByRole("button", { name: text, exact: true }).click();
}

export async function waitForText(page: Page, text: string, timeout = 15000) {
  try {
    await expect(page.locator("body")).toContainText(text, { timeout });
  } catch (error) {
    const debug = await page.evaluate(() => {
      const win = window as any;
      return {
        bodyText: (document.body?.innerText || document.body?.textContent || "").slice(0, 1000),
        logs: win.__logs || [],
        browserErrors: win.__deepSearchBrowserErrors || [],
      };
    });
    throw new Error(
      `Expected text "${text}" within ${timeout}ms. Debug: ${JSON.stringify(debug)}`,
      { cause: error },
    );
  }
}

export async function getVisibleBodyText(page: Page) {
  return page.locator("body").innerText();
}

export async function getOpenRouterLogs(page: Page) {
  return page.evaluate(() => (window as any).__logs || []);
}

export async function getFileStorageLog(page: Page) {
  return page.evaluate(() => (window as any).__deepSearchAppFileStorageLog || []);
}
