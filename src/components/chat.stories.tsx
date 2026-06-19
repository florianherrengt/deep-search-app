import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UIMessage } from "ai";
import { Alert, Box, MantineProvider, Text } from "@mantine/core";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import { setStorybookTauriStores } from "@/lib/storybook";
import { Chat } from "./chat";

const modelOptions = [
  {
    id: "openrouter:openrouter%2Ffree",
    provider: "openrouter" as const,
    apiKey: "sk-or-storybook",
    model: "openrouter/free",
    name: "OpenRouter: openrouter/free",
    description: "OpenRouter",
    contextWindowTokens: 64_000,
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    provider: "anthropic" as const,
    apiKey: "",
    model: "claude-sonnet-4-5",
    name: "Anthropic: claude-sonnet-4-5",
    description: "Add Anthropic API key in Settings",
    disabled: true,
  },
];

function ChatStory() {
  setStorybookTauriStores({
    "prompt-templates.json": {
      templates: [
        {
          name: "Research kickoff",
          text: "Search current sources first, then summarize with citations.",
        },
      ],
      lastSelectedTemplate: "Research kickoff",
    },
  });

  return (
    <PromptTemplatesProvider>
      <div style={{ height: "100vh" }}>
        <Chat
          sessionId="storybook-session"
          modelOptions={modelOptions}
          defaultModelId={modelOptions[0].id}
          researchApiKey="storybook-key"
          runtimeChatId="storybook-runtime-chat"
          researchChatId="storybook-research-chat"
          researchFolder="2026-06-06_storybook-integration"
          selectedModelId={modelOptions[0].id}
          onSelectedModelIdChange={() => undefined}
          searchKeys={{
            braveApiKey: "BSA-storybook",
            exaApiKey: null,
            serperApiKey: null,
            tavilyApiKey: null,
            searxngBaseUrl: null,
            chromeDevToolsMcpEnabled: false,
          }}
          currency="USD"
        />
      </div>
    </PromptTemplatesProvider>
  );
}

const meta = {
  title: "Chat/Chat",
  component: ChatStory,
  render: () => <ChatStory />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ChatStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySession: Story = {
  tags: ["!snapshot"],
};

function generateHeavyConversation(steps = 30) {
  const messages: Array<Record<string, unknown>> = [];
  let idx = 0;
  for (let s = 0; s < steps; s++) {
    const letter = String.fromCharCode(97 + (s % 26));
    messages.push({
      id: `user-${++idx}`, role: "user",
      parts: [{ type: "text", text: `Research topic ${letter} step ${s + 1}.` }],
    });
    const toolNames = ["web_search", "extract_page_content", "search_research"] as const;
    const toolParts = Array.from({ length: 3 }, (_, i) => {
      const isExtract = i === 1;
      const resultText = isExtract
        ? "Extracted page content:\n\n" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(143)
        : `Search result 1 for topic ${letter}: found relevant data. `.repeat(30);
      return {
        type: `tool-${toolNames[i]}`,
        toolCallId: `c-${s}-${i}`,
        state: "output-available",
        input: { query: `topic ${letter} part ${i}` },
        output: isExtract
          ? { success: true, content: resultText, url: `https://ex.com/p-${s}-${i}` }
          : { success: true, results: [{ title: `R${i}`, url: `https://ex.com/${s}-${i}` }] },
      };
    });
    messages.push({
      id: `asst-${++idx}`, role: "assistant",
      parts: [
        ...toolParts,
        { type: "text", text: `Analysis for topic ${letter}: based on the research, here's what I found. `.repeat(20) },
      ],
    });
  }
  return messages;
}

function HeavyChatStory() {
  const messagesRef = { current: generateHeavyConversation(30) as never[] };

  setStorybookTauriStores({
    "prompt-templates.json": {
      templates: [{ name: "Research kickoff", text: "Search current sources first, then summarize with citations." }],
      lastSelectedTemplate: "Research kickoff",
    },
  });

  return (
    <PromptTemplatesProvider>
      <div style={{ height: "100vh" }}>
        <Chat
          sessionId="heavy-session"
          modelOptions={modelOptions}
          defaultModelId={modelOptions[0].id}
          researchApiKey="storybook-key"
          runtimeChatId="heavy-runtime-chat"
          researchChatId="heavy-research-chat"
          researchFolder="2026-06-08_heavy-benchmark"
          selectedModelId={modelOptions[0].id}
          initialMessages={messagesRef.current}
          onSelectedModelIdChange={() => undefined}
          searchKeys={{
            braveApiKey: "BSA-storybook",
            exaApiKey: null,
            serperApiKey: null,
            tavilyApiKey: null,
            searxngBaseUrl: null,
            chromeDevToolsMcpEnabled: false,
          }}
          currency="USD"
        />
      </div>
    </PromptTemplatesProvider>
  );
}

export const HeavyConversation: Story = {
  tags: ["!snapshot", "skip-screenshot"],
  render: () => <HeavyChatStory />,
};

const restoredQuestionMessages: UIMessage[] = [
  {
    id: "user-restored-question",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Compare the existing research with a fresh search.",
      },
    ],
  },
  {
    id: "assistant-restored-question",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "question-tool-restored",
        state: "output-available",
        input: {
          questions: [
            {
              question: "Should I continue the previous research or start fresh?",
              candidates: [
                { label: "Continue previous", value: "continue:market-map" },
                { label: "Start fresh", value: "new" },
              ],
            },
          ],
        },
        output: {
          answers: [
            {
              question: "Should I continue the previous research or start fresh?",
              answer: "continue:market-map",
            },
          ],
        },
      } as UIMessage["parts"][number],
    ],
  },
];

function RestoredQuestionToolStory() {
  setStorybookTauriStores({
    "prompt-templates.json": {
      templates: [
        { name: "Research kickoff", text: "Search current sources first." },
      ],
      lastSelectedTemplate: "Research kickoff",
    },
  });

  return (
    <PromptTemplatesProvider>
      <div style={{ height: "100vh" }}>
        <Chat
          sessionId="restored-question-session"
          modelOptions={modelOptions}
          defaultModelId={modelOptions[0].id}
          researchApiKey="storybook-key"
          runtimeChatId="restored-question-runtime-chat"
          researchChatId="restored-question-research-chat"
          researchFolder="2026-06-08_restored-question-tool"
          selectedModelId={modelOptions[0].id}
          initialMessages={restoredQuestionMessages}
          onSelectedModelIdChange={() => undefined}
          searchKeys={{
            braveApiKey: "BSA-storybook",
            exaApiKey: null,
            serperApiKey: null,
            tavilyApiKey: null,
            searxngBaseUrl: null,
            chromeDevToolsMcpEnabled: false,
          }}
          currency="USD"
        />
      </div>
    </PromptTemplatesProvider>
  );
}

export const RestoredQuestionTool: Story = {
  render: () => <RestoredQuestionToolStory />,
};

function ErrorLayoutStory() {
  return (
    <MantineProvider>
      <div style={{ height: "100vh" }}>
        <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <Alert
            variant="light"
            color="red"
            title="Connection Error"
            withCloseButton
            mb="xs"
          >
            Invalid value for &lsquo;tool_call&rsquo;: no function named
            &lsquo;brave_search&rsquo; was specified in the &lsquo;tools&rsquo;
            parameter.
          </Alert>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Box
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Box
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "16px 24px",
                }}
              >
                <Text size="sm" c="dimmed">
                  Previous messages would appear here.
                </Text>
              </Box>
              <Box
                style={{
                  flexShrink: 0,
                  borderTop: "1px solid var(--mantine-color-default-border)",
                  padding: "12px 24px",
                }}
              >
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid var(--mantine-color-default-border)",
                    background: "var(--mantine-color-body)",
                    padding: "12px 16px",
                    fontSize: 14,
                    color: "var(--mantine-color-dimmed)",
                  }}
                  data-testid="composer-input"
                >
                  Ask something...
                </div>
              </Box>
            </Box>
          </div>
        </Box>
      </div>
    </MantineProvider>
  );
}

export const ErrorWithVisibleInput: Story = {
  render: () => <ErrorLayoutStory />,
  play: async ({ canvasElement }) => {
    const { within, expect } = await import("storybook/test");
    const canvas = within(canvasElement);
    const input = await canvas.findByTestId("composer-input");
    const rect = input.getBoundingClientRect();
    await expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  },
};
