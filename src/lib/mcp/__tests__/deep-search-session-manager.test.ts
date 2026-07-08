import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModelConfig } from "@/lib/chat-providers";
import type { SearchToolKeys } from "@/lib/transport";

const mocks = vi.hoisted(() => ({
  assistantResponses: [] as UIMessage[],
  createResearchChatId: vi.fn(),
  readUIMessageStream: vi.fn(),
  saveResearchChatMessages: vi.fn(),
  sendMessages: vi.fn(),
  setDirectEventHandler: vi.fn(),
  shouldContinueAfterToolResult: vi.fn(),
}));

vi.mock("ai", () => ({
  readUIMessageStream: mocks.readUIMessageStream,
}));

vi.mock("@/lib/research-history", () => ({
  createResearchChatId: mocks.createResearchChatId,
  saveResearchChatMessages: mocks.saveResearchChatMessages,
}));

vi.mock("@/lib/sub-agent-emitter", () => ({
  setDirectEventHandler: mocks.setDirectEventHandler,
}));

vi.mock("@/lib/transport", () => ({
  DirectTransport: class DirectTransport {
    sendMessages = mocks.sendMessages;
  },
  shouldContinueAfterToolResult: mocks.shouldContinueAfterToolResult,
}));

import { DeepSearchSessionManager } from "@/lib/mcp/deep-search-session-manager";

describe("DeepSearchSessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assistantResponses.length = 0;
    mocks.createResearchChatId.mockReturnValue("chat-1");
    mocks.readUIMessageStream.mockImplementation(() => {
      return (async function* () {
        const response = mocks.assistantResponses.shift();
        if (response) yield response;
      })();
    });
    mocks.saveResearchChatMessages.mockResolvedValue(undefined);
    mocks.sendMessages.mockResolvedValue(closedStream());
    mocks.shouldContinueAfterToolResult.mockReturnValue(false);
  });

  it("appends follow-up questions to the existing research chat history", async () => {
    const manager = createManager();
    mocks.assistantResponses.push(assistantTextMessage("First answer."));

    const first = await manager.handle({ question: "Initial question" });

    expect(first.status).toBe("done");
    expect(first).toMatchObject({ result: "First answer." });

    mocks.assistantResponses.push(assistantTextMessage("Follow-up answer."));
    const followUp = await manager.handle({
      session_id: first.session_id,
      question: "Follow-up question",
    });

    expect(followUp.status).toBe("done");
    expect(followUp).toMatchObject({ result: "Follow-up answer." });

    const secondCall = mocks.sendMessages.mock.calls[1]?.[0];
    expect(secondCall?.chatId).toBe("chat-1");
    expect(messageTextParts(secondCall?.messages as UIMessage[])).toEqual([
      ["user", "Initial question"],
      ["assistant", "First answer."],
      ["user", "Follow-up question"],
    ]);
  });

  it("stores guarded retry output as one clean assistant reply before follow-up", async () => {
    const manager = createManager();
    mocks.assistantResponses.push(guardedRetryMessage());

    const first = await manager.handle({ question: "Initial question" });

    expect(first.status).toBe("done");
    expect(first).toMatchObject({ result: "Final retry answer." });

    mocks.assistantResponses.push(assistantTextMessage("Follow-up answer."));
    await manager.handle({
      session_id: first.session_id,
      question: "Follow-up question",
    });

    const secondCall = mocks.sendMessages.mock.calls[1]?.[0];
    expect(messageTextParts(secondCall?.messages as UIMessage[])).toEqual([
      ["user", "Initial question"],
      ["assistant", "Final retry answer."],
      ["user", "Follow-up question"],
    ]);
  });

  it("skips pending questions and continues until the final answer", async () => {
    const manager = createManager();
    mocks.assistantResponses.push(
      pendingQuestionMessage(),
      assistantTextMessage("Final answer."),
    );
    mocks.shouldContinueAfterToolResult
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await manager.handle({ question: "Initial question" });

    expect(result.status).toBe("done");
    expect(result).toMatchObject({ result: "Final answer." });
    expect(mocks.sendMessages).toHaveBeenCalledTimes(2);

    const secondCall = mocks.sendMessages.mock.calls[1]?.[0];
    const skippedQuestionPart = (secondCall?.messages as UIMessage[])[1]?.parts[0];
    expect(skippedQuestionPart).toMatchObject({
      type: "tool-ask_questions",
      state: "output-available",
      output: {
        skipped: true,
        answers: [
          {
            question: "Pick an answer style.",
            answer: expect.stringContaining("Skipped"),
          },
        ],
      },
    });
  });

  it("rejects legacy question answers", async () => {
    const manager = createManager();

    await expect(
      manager.handle({ session_id: "missing", answers: ["concise"] }),
    ).rejects.toThrow("Question answers are no longer supported");
  });
});

function createManager() {
  const chatModel: ChatModelConfig = {
    provider: "openrouter",
    apiKey: "test-key",
    model: "test-model",
  };
  const searchKeys: SearchToolKeys = {
    braveApiKey: null,
    exaApiKey: null,
    serperApiKey: null,
    tavilyApiKey: null,
    searxngBaseUrl: null,
    chromeDevToolsMcpEnabled: false,
  };

  return new DeepSearchSessionManager({
    getChatModel: () => chatModel,
    getSearchKeys: () => searchKeys,
  });
}

function closedStream(): ReadableStream<never> {
  return new ReadableStream<never>({
    start(controller) {
      controller.close();
    },
  });
}

function assistantTextMessage(text: string): UIMessage {
  return {
    id: `assistant-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

function pendingQuestionMessage(): UIMessage {
  return {
    id: "assistant-question",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "question-1",
        state: "input-available",
        input: {
          questions: [
            {
              question: "Pick an answer style.",
              candidates: [
                { label: "Concise", value: "concise" },
                { label: "Detailed", value: "detailed" },
              ],
            },
          ],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function guardedRetryMessage(): UIMessage {
  return {
    id: "assistant-guarded",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "text", text: "First attempt." },
      guardrailEventPart(),
      { type: "step-start" },
      { type: "text", text: "Final retry answer." },
    ],
  };
}

function guardrailEventPart(): UIMessage["parts"][number] {
  return {
    type: "data-guardrail_event",
    id: "guardrail-1",
    data: {
      kind: "research_checkpoint",
      status: "retrying",
      title: "Research depth reminder",
      message: "Prompted the agent to consider whether more research is needed.",
      reason: "The answer did not show enough research tool use.",
      attempt: 1,
    },
  } as UIMessage["parts"][number];
}

function messageTextParts(messages: UIMessage[]): Array<[string, string]> {
  return messages.map((message): [string, string] => [
    message.role,
    message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(""),
  ]);
}
