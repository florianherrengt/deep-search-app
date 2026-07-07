// @vitest-environment jsdom
import { type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { UIMessage } from "ai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SubAgentProvider } from "@/lib/sub-agent-store";

const chatMocks = vi.hoisted(() => ({
  currentChat: null as unknown,
  useChat: vi.fn(),
  useAISDKRuntime: vi.fn(() => ({ runtime: true })),
  thread: vi.fn(() => <div data-testid="chat-thread" />),
  questionsTool: vi.fn(() => <div data-testid="questions-tool" />),
  directTransportSetResearchFolder: vi.fn(),
  saveResearchChatMessages: vi.fn(async () => undefined),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: chatMocks.useChat,
}));

vi.mock("@assistant-ui/react-ai-sdk", () => ({
  useAISDKRuntime: chatMocks.useAISDKRuntime,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@assistant-ui/react")>();
  return {
    ...actual,
    AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="runtime-provider">{children}</div>
    ),
  };
});

vi.mock("@/components/assistant-ui/thread", () => ({
  Thread: chatMocks.thread,
}));

vi.mock("@/components/assistant-ui/questions-tool", () => ({
  QuestionsToolUI: chatMocks.questionsTool,
}));

vi.mock("@/lib/transport", () => ({
  DirectTransport: class DirectTransport {
    setResearchFolder = chatMocks.directTransportSetResearchFolder;
  },
  shouldContinueAfterToolResult: vi.fn(() => false),
}));

vi.mock("@/lib/chat-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-providers")>();
  return {
    ...actual,
    fetchChatModelContextWindowTokens: vi.fn(async () => null),
  };
});

vi.mock("@/lib/research-history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research-history")>();
  return {
    ...actual,
    saveResearchChatMessages: chatMocks.saveResearchChatMessages,
  };
});

vi.mock("@/lib/sub-agent-profiler", () => ({
  useSubAgentRenderCounter: () => undefined,
  recordSubAgentHandlerDuration: () => undefined,
  recordSubAgentSubscription: () => undefined,
  recordSubAgentUpdateDuration: () => undefined,
  startSubAgentProfileMeasure: () => 0,
}));

import { Chat } from "@/components/chat";
import { shouldContinueAfterToolResult } from "@/lib/transport";

const modelOptions = [
  {
    id: "openrouter:test",
    provider: "openrouter" as const,
    apiKey: "test-key",
    model: "test-model",
    name: "OpenRouter: test-model",
    description: "Test model",
    contextWindowTokens: 64_000,
  },
];

const searchKeys = {
  braveApiKey: null,
  exaApiKey: null,
  serperApiKey: null,
  tavilyApiKey: null,
  searxngBaseUrl: null,
  chromeDevToolsMcpEnabled: false,
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  chatMocks.currentChat = createChatState();
  chatMocks.useChat.mockImplementation(() => chatMocks.currentChat);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Chat visibility", () => {
  it("keeps invisible running chats headless while reporting state", async () => {
    const onRunStateChange = vi.fn();
    const onAttentionStateChange = vi.fn();
    chatMocks.currentChat = createChatState({
      status: "streaming",
      messages: [
        {
          id: "assistant-question",
          role: "assistant",
          parts: [
            {
              type: "tool-ask_questions",
              toolCallId: "question-call",
              state: "input-available",
              input: {
                questions: [
                  {
                    question: "Continue?",
                    candidates: [{ label: "Yes", value: "yes" }],
                  },
                ],
              },
            } as UIMessage["parts"][number],
          ],
        },
      ],
    });

    renderChat({
      visible: false,
      onRunStateChange,
      onAttentionStateChange,
    });

    expect(screen.queryByTestId("chat-thread")).toBeNull();
    expect(screen.queryByTestId("runtime-provider")).toBeNull();
    expect(chatMocks.useAISDKRuntime).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onRunStateChange).toHaveBeenCalledWith("session-one", true);
      expect(onAttentionStateChange).toHaveBeenCalledWith("session-one", true);
    });
  });

  it("renders the assistant runtime tree when visible", () => {
    renderChat({ visible: true });

    expect(screen.getByTestId("runtime-provider")).toBeTruthy();
    expect(screen.getByTestId("chat-thread")).toBeTruthy();
    expect(screen.getByTestId("questions-tool")).toBeTruthy();
    expect(chatMocks.useAISDKRuntime).toHaveBeenCalledTimes(1);
  });
});

describe("Chat auto-continuation", () => {
  it("delegates automatic sends for non-aborted finishes", () => {
    const shouldContinue = vi.mocked(shouldContinueAfterToolResult);
    shouldContinue.mockReturnValue(true);

    renderChat({ visible: false });

    const options = chatMocks.useChat.mock.calls[0][0];
    const messages = [completedSearchToolMessage("assistant-tool-result")];

    options.onFinish({ messages, isAbort: false });

    expect(options.sendAutomaticallyWhen({ messages })).toBe(true);
    expect(shouldContinue).toHaveBeenCalledWith({ messages });
  });

  it("suppresses the next automatic send after a user stop", () => {
    const shouldContinue = vi.mocked(shouldContinueAfterToolResult);
    shouldContinue.mockReturnValue(true);

    renderChat({ visible: false });

    const options = chatMocks.useChat.mock.calls[0][0];
    const messages = [completedSearchToolMessage("assistant-tool-result")];

    options.onFinish({ messages, isAbort: true });

    expect(options.sendAutomaticallyWhen({ messages })).toBe(false);
    expect(shouldContinue).not.toHaveBeenCalled();

    expect(options.sendAutomaticallyWhen({ messages })).toBe(true);
    expect(shouldContinue).toHaveBeenCalledWith({ messages });
  });

  it("suppresses automatic sends after a stopped tool error result", () => {
    const shouldContinue = vi.mocked(shouldContinueAfterToolResult);
    shouldContinue.mockReturnValue(true);

    renderChat({ visible: false });

    const options = chatMocks.useChat.mock.calls[0][0];
    const messages = [
      completedSearchToolMessage("assistant-tool-error", "output-error"),
    ];

    options.onFinish({ messages, isAbort: true });

    expect(options.sendAutomaticallyWhen({ messages })).toBe(false);
    expect(shouldContinue).not.toHaveBeenCalled();
  });

  it("does not carry abort suppression into a later message", () => {
    const shouldContinue = vi.mocked(shouldContinueAfterToolResult);
    shouldContinue.mockReturnValue(true);

    renderChat({ visible: false });

    const options = chatMocks.useChat.mock.calls[0][0];
    const abortedMessages = [
      {
        id: "assistant-aborted",
        role: "assistant",
        parts: [],
      } satisfies UIMessage,
    ];
    const laterMessages = [
      ...abortedMessages,
      {
        id: "user-later",
        role: "user",
        parts: [{ type: "text", text: "Continue" }],
      } satisfies UIMessage,
    ];

    options.onFinish({ messages: abortedMessages, isAbort: true });

    expect(options.sendAutomaticallyWhen({ messages: laterMessages })).toBe(true);
    expect(shouldContinue).toHaveBeenCalledWith({ messages: laterMessages });
  });
});

function completedSearchToolMessage(
  id: string,
  state: "output-available" | "output-error" = "output-available",
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "step-start",
      },
      {
        type: "tool-brave_search",
        toolCallId: "brave-1",
        state,
        input: { query: "pricing" },
        ...(state === "output-available"
          ? { output: "results" }
          : { errorText: "Search aborted" }),
      } as UIMessage["parts"][number],
    ],
  };
}

function renderChat({
  visible,
  onRunStateChange = vi.fn(),
  onAttentionStateChange = vi.fn(),
}: {
  visible: boolean;
  onRunStateChange?: (sessionId: string, running: boolean) => void;
  onAttentionStateChange?: (sessionId: string, needsAttention: boolean) => void;
}) {
  return render(
    <MantineProvider>
      <SubAgentProvider>
        <Chat
          sessionId="session-one"
          runtimeChatId="runtime-chat-one"
          researchChatId="research-chat-one"
          researchFolder={null}
          researchApiKey="test-key"
          modelOptions={modelOptions}
          defaultModelId={modelOptions[0].id}
          selectedModelId={modelOptions[0].id}
          visible={visible}
          onSelectedModelIdChange={() => undefined}
          onRunStateChange={onRunStateChange}
          onAttentionStateChange={onAttentionStateChange}
          searchKeys={searchKeys}
        />
      </SubAgentProvider>
    </MantineProvider>,
  );
}

function createChatState({
  status = "ready",
  messages = [],
  error = undefined,
}: {
  status?: string;
  messages?: UIMessage[];
  error?: Error;
} = {}) {
  return {
    id: "runtime-chat-one",
    messages,
    status,
    error,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    resumeStream: vi.fn(),
    addToolResult: vi.fn(),
    addToolOutput: vi.fn(),
    setMessages: vi.fn(),
    clearError: vi.fn(),
  };
}
