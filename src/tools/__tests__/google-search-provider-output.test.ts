import { createDeepSeek } from "@ai-sdk/deepseek";
import { describe, expect, it, vi } from "vitest";
import { extractGoogleSearchResults } from "@/tools/google-search-extractor";

const GOOGLE_HTML = `
  <html><body>
    <a href="https://www.decathlon.fr/p/eclairage-velo-usb-c/_/R-p-123">
      Éclairage vélo USB-C
    </a>
    <div>Éclairage rechargeable pour vélo.</div>
  </body></html>
`;

describe("Google extraction provider integration", () => {
  it("disables DeepSeek reasoning and validates plain model JSON locally", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const thinking = requestBody.thinking as
        | { type?: string }
        | undefined;
      const reasoningDisabled = thinking?.type === "disabled";

      return new Response(
        JSON.stringify({
          id: "response-1",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              message: reasoningDisabled
                ? {
                    role: "assistant",
                    content: JSON.stringify({
                      status: "results",
                      results: [
                        {
                          title: "Éclairage vélo USB-C",
                          url: "https://www.decathlon.fr/p/eclairage-velo-usb-c/_/R-p-123",
                          description: "Éclairage rechargeable pour vélo.",
                        },
                      ],
                    }),
                  }
                : {
                    role: "assistant",
                    content: "",
                    reasoning_content: "Reasoning consumed the output budget.",
                  },
              finish_reason: reasoningDisabled ? "stop" : "length",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const model = createDeepSeek({
      apiKey: "test",
      fetch: fetchMock,
    })("deepseek-v4-flash");

    await expect(
      extractGoogleSearchResults(
        model,
        "site:decathlon.fr éclairage vélo USB-C rechargeable",
        GOOGLE_HTML,
      ),
    ).resolves.toEqual([
      {
        title: "Éclairage vélo USB-C",
        url: "https://www.decathlon.fr/p/eclairage-velo-usb-c/_/R-p-123",
        description: "Éclairage rechargeable pour vélo.",
        snippet: "Éclairage rechargeable pour vélo.",
      },
    ]);

    expect(requestBody).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(requestBody).not.toHaveProperty("response_format");
  });
});
