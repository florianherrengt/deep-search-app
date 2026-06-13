import { test, expect } from "../fixtures";

test.describe("Chat with mocked LLM", () => {
  test("sends a message and receives a mocked response", async ({
    chatPage,
  }) => {
    await chatPage.evaluate(() => {
      const encoder = new TextEncoder();

      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.href : String(input);

        if (!href.includes("chat/completions")) {
          return globalThis.fetch(input, init);
        }

        const body = init?.body;
        const isStream =
          typeof body === "string" && body.includes('"stream":true');

        if (isStream) {
          const chunks = [
            { id: "e2e-mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
            { id: "e2e-mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello from e2e test!" }, finish_reason: null }] },
            { id: "e2e-mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ];

          const sseBody = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sseBody));
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        return new Response(
          JSON.stringify({
            id: "e2e-mock-json",
            object: "chat.completion",
            model: "openrouter/auto",
            choices: [{ index: 0, message: { role: "assistant", content: "test-folder-name" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      window.__deepSearchBridgeMock!.fetch = mockFetch;
    });

    const textarea = chatPage.getByPlaceholder("Ask something...");
    await textarea.fill("Hello!");

    const sendButton = chatPage.getByRole("button", { name: "Send" });
    await sendButton.click();

    await expect(chatPage.getByTestId("assistant-message").filter({ hasText: "Hello from e2e test!" })).toBeVisible({
      timeout: 15000,
    });
  });
});
