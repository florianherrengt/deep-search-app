import { test, expect, type Page } from "../fixtures";

const INPUT_LATENCY_BUDGET_MS = 750;
const SEND_CLICK_BUDGET_MS = 750;

test.describe("Chat background streaming performance", () => {
  test("keeps active composer responsive while an inactive search streams", async ({
    configuredChatPage: chatPage,
  }) => {
    await installSlowStreamingMock(chatPage);
    await installLongTaskRecorder(chatPage);

    const textarea = chatPage.getByPlaceholder("Ask something...");
    await textarea.fill("Background stream latency test");
    await chatPage.getByRole("button", { name: "Send" }).click();

    await chatPage.waitForFunction(
      () => (window.__backgroundStreamChunkCount ?? 0) >= 10,
      null,
      { timeout: 10000 },
    );

    await chatPage.getByRole("button", { name: "New Chat" }).click();
    const activeTextarea = chatPage.getByPlaceholder("Ask something...");
    await expect(activeTextarea).toBeVisible();

    const inputLatencyMs = await measureInputLatency(
      chatPage,
      "Typing while another search is still streaming",
    );
    expect(inputLatencyMs).toBeLessThan(INPUT_LATENCY_BUDGET_MS);

    const sendClickStart = Date.now();
    await chatPage.getByRole("button", { name: "Send" }).click();
    const sendClickMs = Date.now() - sendClickStart;
    expect(sendClickMs).toBeLessThan(SEND_CLICK_BUDGET_MS);

    const maxLongTaskMs = await chatPage.evaluate(() =>
      Math.max(0, ...(window.__backgroundStreamLongTasks ?? [])),
    );
    expect(maxLongTaskMs).toBeLessThan(INPUT_LATENCY_BUDGET_MS);
  });
});

async function installSlowStreamingMock(page: Page) {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    let streamCallCount = 0;

    window.__backgroundStreamChunkCount = 0;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : String(input);

      if (!href.includes("chat/completions")) {
        return originalFetch(input, init);
      }

      const requestBody = parseRequestBody(init?.body);
      if (!requestBody?.stream) {
        return jsonTextResponse(nonStreamingContent(requestBody));
      }

      streamCallCount += 1;
      const isBackgroundStream = streamCallCount === 1;
      const chunks = isBackgroundStream ? 260 : 8;
      const delayMs = isBackgroundStream ? 12 : 1;

      return new Response(
        new ReadableStream({
          start(controller) {
            let index = 0;

            const emit = () => {
              if (index === 0) {
                enqueue(controller, {
                  id: "perf-mock",
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: { role: "assistant", content: "" },
                      finish_reason: null,
                    },
                  ],
                });
              } else if (index <= chunks) {
                if (isBackgroundStream) {
                  window.__backgroundStreamChunkCount =
                    (window.__backgroundStreamChunkCount ?? 0) + 1;
                }
                enqueue(controller, {
                  id: "perf-mock",
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: ` **chunk-${index}** [link](https://example.com) | a | b |\n|---|---|\n| ${index} | value |\n`,
                      },
                      finish_reason: null,
                    },
                  ],
                });
              } else {
                enqueue(controller, {
                  id: "perf-mock",
                  object: "chat.completion.chunk",
                  choices: [
                    { index: 0, delta: {}, finish_reason: "stop" },
                  ],
                });
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                return;
              }

              index += 1;
              setTimeout(emit, delayMs);
            };

            emit();
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    window.__deepSearchBridgeMock!.fetch = mockFetch;

    function enqueue(
      controller: ReadableStreamDefaultController<Uint8Array>,
      chunk: unknown,
    ) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }

    function parseRequestBody(body: BodyInit | null | undefined) {
      if (typeof body !== "string") return null;
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }

    function nonStreamingContent(body: unknown) {
      const serialized = JSON.stringify(body ?? {});
      if (serialized.includes("Memory Extraction") || serialized.includes("memories")) {
        return "[]";
      }
      if (serialized.includes("research checkpoint")) {
        return "Continue researching if more evidence would materially improve the answer.";
      }
      if (serialized.includes("You name research folders")) {
        return "background-stream-latency-test";
      }
      return "OK";
    }

    function jsonTextResponse(content: string) {
      return new Response(
        JSON.stringify({
          id: "perf-mock-json",
          object: "chat.completion",
          model: "openrouter/auto",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  });
}

async function installLongTaskRecorder(page: Page) {
  await page.evaluate(() => {
    window.__backgroundStreamLongTasks = [];
    if (!("PerformanceObserver" in window)) return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__backgroundStreamLongTasks!.push(entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long task timing is a best-effort signal; input latency remains the hard assertion.
    }
  });
}

async function measureInputLatency(page: Page, value: string) {
  return page.evaluate(
    (nextValue) =>
      new Promise<number>((resolve, reject) => {
        const textarea = Array.from(document.querySelectorAll("textarea")).find(
          (candidate) =>
            candidate instanceof HTMLTextAreaElement &&
            candidate.offsetParent !== null,
        );

        if (!(textarea instanceof HTMLTextAreaElement)) {
          reject(new Error("Visible chat composer textarea not found"));
          return;
        }

        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;

        if (!valueSetter) {
          reject(new Error("Textarea value setter not found"));
          return;
        }

        const startedAt = performance.now();
        textarea.focus();
        valueSetter.call(textarea, nextValue);
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(performance.now() - startedAt);
          });
        });
      }),
    value,
  );
}

declare global {
  interface Window {
    __backgroundStreamChunkCount?: number;
    __backgroundStreamLongTasks?: number[];
  }
}
