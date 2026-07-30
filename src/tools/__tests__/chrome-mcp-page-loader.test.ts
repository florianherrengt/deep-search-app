// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallTool = vi.fn();
const mockGetClient = vi.fn();
const mockExclusive = vi.fn(
  <T>(operation: () => Promise<T>, _signal?: AbortSignal) => operation(),
);

vi.mock("@/lib/tauri-bridge", () => ({
  isTauri: vi.fn(() => true),
  isNotificationPermissionGranted: vi.fn(async () => false),
  requestNotificationPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));

vi.mock("@/lib/mcp/chrome-devtools-tools", () => ({
  withChromeDevToolsMcpClient: <T>(
    connection: unknown,
    operation: (client: unknown) => Promise<T>,
    signal?: AbortSignal,
  ) =>
    mockExclusive(async () => {
      const client = await mockGetClient(connection);
      return operation(client);
    }, signal),
}));

import { isTauri } from "@/lib/tauri-bridge";
import {
  createChromeMcpPageLoader,
  parseEvaluatedPageSnapshot,
  renderWithManagedChromeMcp,
} from "../chrome-mcp-page-loader";

const MOCK_HTML = "<html><body><p>Hello from Chrome MCP</p></body></html>";
const ORIGINAL_PAGE = {
  id: 4,
  url: "https://original.example/",
  selected: true,
};
const MANAGED_PAGE = {
  id: 9,
  url: "https://example.com/",
  selected: true,
};

function pages(...values: Array<typeof ORIGINAL_PAGE>) {
  return { structuredContent: { pages: values }, isError: false };
}

function configureSuccessfulTransaction(html = MOCK_HTML) {
  mockCallTool.mockImplementation(
    async ({ name }: { name: string }) => {
      if (name === "list_pages") return pages(ORIGINAL_PAGE);
      if (name === "new_page") {
        return pages(
          { ...ORIGINAL_PAGE, selected: false },
          MANAGED_PAGE,
        );
      }
      if (name === "evaluate_script") {
        return { content: [{ type: "text", text: html }], isError: false };
      }
      return { content: [], isError: false };
    },
  );
}

function calledToolNames() {
  return mockCallTool.mock.calls.map(
    ([request]) => (request as { name: string }).name,
  );
}

function mcpEvaluationEnvelope(value: unknown): string {
  return `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

describe("managed Chrome MCP page loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    mockGetClient.mockResolvedValue({ callTool: mockCallTool });
    mockExclusive.mockImplementation(
      <T>(operation: () => Promise<T>, _signal?: AbortSignal) => operation(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a render-only PageLoader", () => {
    const loader = createChromeMcpPageLoader({});

    expect(loader.fetchHtml).toBeUndefined();
    expect(loader.renderHtml).toEqual(expect.any(Function));
  });

  it("opens a temporary page, extracts it, closes it, and restores the original selection", async () => {
    configureSuccessfulTransaction();

    await expect(
      renderWithManagedChromeMcp("https://example.com", {}),
    ).resolves.toBe(MOCK_HTML);

    expect(calledToolNames()).toEqual([
      "list_pages",
      "new_page",
      "select_page",
      "evaluate_script",
      "close_page",
      "select_page",
    ]);
    expect(mockCallTool).toHaveBeenNthCalledWith(
      2,
      {
        name: "new_page",
        arguments: {
          url: "https://example.com",
          background: true,
          timeout: expect.any(Number),
        },
      },
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(mockCallTool).toHaveBeenNthCalledWith(
      5,
      { name: "close_page", arguments: { pageId: MANAGED_PAGE.id } },
      undefined,
      expect.not.objectContaining({ signal: expect.anything() }),
    );
    expect(mockCallTool).toHaveBeenNthCalledWith(
      6,
      {
        name: "select_page",
        arguments: { pageId: ORIGINAL_PAGE.id, bringToFront: false },
      },
      undefined,
      expect.not.objectContaining({ signal: expect.anything() }),
    );
  });

  it("settles lazy-loaded content before reading the final HTML", async () => {
    configureSuccessfulTransaction();

    await expect(
      renderWithManagedChromeMcp(
        "https://www.google.com/search?q=test",
        {},
        { settleDynamicContent: true },
      ),
    ).resolves.toBe(MOCK_HTML);

    const evaluations = mockCallTool.mock.calls.filter(
      ([request]) =>
        (request as { name: string }).name === "evaluate_script",
    );
    expect(evaluations).toHaveLength(3);
    expect(evaluations[1]?.[0]).toEqual({
      name: "evaluate_script",
      arguments: {
        function: expect.stringContaining("scrollTo"),
      },
    });
  });

  it("decodes the real Chrome MCP evaluate_script response envelope", () => {
    expect(
      parseEvaluatedPageSnapshot(
        mcpEvaluationEnvelope({
          html: "<html><body><h1>Decoded</h1></body></html>",
          url: "https://example.com/decoded",
        }),
        "https://fallback.example/",
      ),
    ).toEqual({
      html: "<html><body><h1>Decoded</h1></body></html>",
      url: "https://example.com/decoded",
    });
  });

  it("decodes MCP envelopes when the page itself contains triple backticks", () => {
    const html = "<html><body><pre>```ts\\nconst value = 1;\\n```</pre></body></html>";

    expect(
      parseEvaluatedPageSnapshot(
        mcpEvaluationEnvelope({ html, url: "https://docs.example/code" }),
        "https://fallback.example/",
      ),
    ).toEqual({ html, url: "https://docs.example/code" });
  });

  it("passes connection config and the abort signal through managed calls", async () => {
    configureSuccessfulTransaction();
    const controller = new AbortController();

    await renderWithManagedChromeMcp(
      "https://example.com",
      {
        connectionMode: "browser-url",
        browserUrl: "http://127.0.0.1:9222",
        nodePath: "/custom/node",
      },
      { signal: controller.signal },
    );

    expect(mockGetClient).toHaveBeenCalledWith({
      connectionMode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
      nodePath: "/custom/node",
    });
    expect(mockExclusive).toHaveBeenCalledWith(
      expect.any(Function),
      controller.signal,
    );
    for (const call of mockCallTool.mock.calls.slice(0, 4)) {
      expect(call[2]).toEqual(
        expect.objectContaining({ signal: controller.signal }),
      );
    }
    for (const call of mockCallTool.mock.calls.slice(4)) {
      expect(call[2]).toEqual(expect.objectContaining({ signal: undefined }));
    }
  });

  it("performs abort-safe cleanup after an extraction failure", async () => {
    configureSuccessfulTransaction();
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            MANAGED_PAGE,
          );
        }
        if (name === "evaluate_script") throw new Error("Evaluation failed");
        return { content: [], isError: false };
      },
    );

    await expect(
      renderWithManagedChromeMcp("https://example.com", {}),
    ).rejects.toThrow("Evaluation failed");
    expect(calledToolNames().slice(-2)).toEqual(["close_page", "select_page"]);
  });

  it("does not close an unowned user tab when opening the managed page fails", async () => {
    const userPage = {
      id: 11,
      url: "https://example.com/page?query=user",
      selected: false,
    };
    let listCount = 0;
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") {
          listCount += 1;
          return listCount === 1
            ? pages(ORIGINAL_PAGE)
            : pages(ORIGINAL_PAGE, userPage);
        }
        if (name === "new_page") throw new Error("Navigation timed out");
        return { content: [], isError: false };
      },
    );

    await expect(
      renderWithManagedChromeMcp(
        "https://example.com/page?query=managed",
        {},
      ),
    ).rejects.toThrow("Navigation timed out");
    expect(calledToolNames()).not.toContain("close_page");
    expect(mockCallTool).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: "close_page",
        arguments: { pageId: userPage.id },
      }),
      undefined,
      expect.anything(),
    );
  });

  it("uses the complete URL when disambiguating newly created pages", async () => {
    const userPage = {
      id: 10,
      url: "https://example.com/page?query=user",
      selected: false,
    };
    const managedPage = {
      id: 11,
      url: "https://example.com/page?query=managed",
      selected: false,
    };
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            userPage,
            managedPage,
          );
        }
        if (name === "evaluate_script") {
          return { content: [{ type: "text", text: MOCK_HTML }], isError: false };
        }
        return { content: [], isError: false };
      },
    );

    await expect(
      renderWithManagedChromeMcp(
        "https://example.com/page?query=managed",
        {},
      ),
    ).resolves.toBe(MOCK_HTML);
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: "close_page", arguments: { pageId: managedPage.id } },
      undefined,
      expect.anything(),
    );
    expect(mockCallTool).not.toHaveBeenCalledWith(
      { name: "close_page", arguments: { pageId: userPage.id } },
      undefined,
      expect.anything(),
    );
  });

  it("restores the original page when the user closes the managed challenge tab", async () => {
    vi.useFakeTimers();
    let evaluationCount = 0;
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            MANAGED_PAGE,
          );
        }
        if (name === "evaluate_script") {
          evaluationCount += 1;
          if (evaluationCount > 1) {
            return {
              content: [{ type: "text", text: "The selected page has been closed." }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: mcpEvaluationEnvelope({
                  html: "<html><body><form id='challenge-form'></form></body></html>",
                  url: "https://www.google.com/sorry/index",
                }),
              },
            ],
            isError: false,
          };
        }
        return { content: [], isError: false };
      },
    );

    const rendering = renderWithManagedChromeMcp("https://example.com", {});
    const rejection = expect(rendering).rejects.toThrow(
      "The selected page has been closed.",
    );
    await vi.runAllTimersAsync();
    await rejection;
    expect(calledToolNames().slice(-2)).toEqual(["close_page", "select_page"]);
  });

  it("brings a URL-challenged page forward once and resumes after its URL clears", async () => {
    vi.useFakeTimers();
    let evaluationCount = 0;
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            MANAGED_PAGE,
          );
        }
        if (name === "evaluate_script") {
          evaluationCount += 1;
          return {
            content: [
              {
                type: "text",
                text: mcpEvaluationEnvelope({
                  html:
                    evaluationCount === 1
                      ? "<html><body>Waiting</body></html>"
                      : MOCK_HTML,
                  url:
                    evaluationCount === 1
                      ? "https://www.google.com/sorry/index"
                      : "https://www.google.com/search?q=test",
                }),
              },
            ],
            isError: false,
          };
        }
        return { content: [], isError: false };
      },
    );
    const onHumanVerification = vi.fn();

    const rendering = renderWithManagedChromeMcp(
      "https://example.com",
      {},
      { onHumanVerification },
    );
    await vi.runAllTimersAsync();

    await expect(rendering).resolves.toBe(MOCK_HTML);
    expect(onHumanVerification).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith(
      {
        name: "select_page",
        arguments: { pageId: MANAGED_PAGE.id, bringToFront: true },
      },
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(evaluationCount).toBe(2);
    expect(calledToolNames().slice(-2)).toEqual(["close_page", "select_page"]);
    expect(mockCallTool).toHaveBeenLastCalledWith(
      {
        name: "select_page",
        arguments: { pageId: ORIGINAL_PAGE.id, bringToFront: true },
      },
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("reselects the managed page before polling after the user switches tabs", async () => {
    vi.useFakeTimers();
    let selectedPageId = ORIGINAL_PAGE.id;
    let managedEvaluationCount = 0;
    mockCallTool.mockImplementation(
      async ({
        name,
        arguments: args,
      }: {
        name: string;
        arguments?: { pageId?: number };
      }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          selectedPageId = MANAGED_PAGE.id;
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            MANAGED_PAGE,
          );
        }
        if (name === "select_page") {
          selectedPageId = args?.pageId ?? selectedPageId;
          return { content: [], isError: false };
        }
        if (name === "evaluate_script") {
          if (selectedPageId !== MANAGED_PAGE.id) {
            return {
              content: [
                {
                  type: "text",
                  text: mcpEvaluationEnvelope({
                    html: "<html><body>User page</body></html>",
                    url: ORIGINAL_PAGE.url,
                  }),
                },
              ],
              isError: false,
            };
          }

          managedEvaluationCount += 1;
          return {
            content: [
              {
                type: "text",
                text: mcpEvaluationEnvelope({
                  html:
                    managedEvaluationCount === 1
                      ? "<html><body>Waiting</body></html>"
                      : MOCK_HTML,
                  url:
                    managedEvaluationCount === 1
                      ? "https://www.google.com/sorry/index"
                      : "https://www.google.com/search?q=test",
                }),
              },
            ],
            isError: false,
          };
        }
        return { content: [], isError: false };
      },
    );

    const rendering = renderWithManagedChromeMcp(
      "https://example.com",
      {},
      {
        onHumanVerification: () => {
          selectedPageId = ORIGINAL_PAGE.id;
        },
      },
    );
    await vi.runAllTimersAsync();

    await expect(rendering).resolves.toBe(MOCK_HTML);
    expect(managedEvaluationCount).toBe(2);
  });

  it("returns null when Chrome returns no HTML text", async () => {
    configureSuccessfulTransaction();
    mockCallTool.mockImplementation(
      async ({ name }: { name: string }) => {
        if (name === "list_pages") return pages(ORIGINAL_PAGE);
        if (name === "new_page") {
          return pages(
            { ...ORIGINAL_PAGE, selected: false },
            MANAGED_PAGE,
          );
        }
        if (name === "evaluate_script") {
          return { content: [{ type: "image" }], isError: false };
        }
        return { content: [], isError: false };
      },
    );

    await expect(
      renderWithManagedChromeMcp("https://example.com", {}),
    ).resolves.toBeNull();
    expect(calledToolNames().slice(-2)).toEqual(["close_page", "select_page"]);
  });

  it("is unavailable outside Tauri", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    await expect(
      renderWithManagedChromeMcp("https://example.com", {}),
    ).resolves.toBeNull();
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("reports Chrome startup/configuration errors without switching backends", async () => {
    mockGetClient.mockRejectedValue(new Error("Chrome MCP is not connected"));

    await expect(
      renderWithManagedChromeMcp("https://example.com", {}),
    ).rejects.toThrow("Chrome MCP is not connected");
    expect(mockCallTool).not.toHaveBeenCalled();
  });
});
