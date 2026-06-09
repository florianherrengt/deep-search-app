import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UIMessage } from "ai";
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
          embeddingConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "qwen/qwen3-embedding-4b",
            dimensions: 1024,
            query_prefix: "Represent this sentence for searching relevant passages: ",
          }}
          rerankerConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "cohere/rerank-4-pro",
          }}
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
    messages.push({
      id: `asst-${++idx}`, role: "assistant",
      parts: [
        ...Array.from({ length: 3 }, (_, i) => ({
          type: "tool-call", toolCallId: `c-${s}-${i}`,
          toolName: i === 0 ? "web_search" : i === 1 ? "extract_page_content" : "search_research",
          args: { query: `topic ${letter} part ${i}` },
        })),
      ],
    });
    for (let t = 0; t < 6; t++) {
      const isExtract = t % 3 === 0;
      const text = isExtract
        ? "Extracted page content:\n\n" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(143)
        : `Search result ${t + 1} for topic ${letter}: found relevant data. `.repeat(30);
      messages.push({
        id: `tr-${++idx}`, role: "user",
        parts: [{ type: "tool-result", toolCallId: `c-${s}-${t % 3}`, toolName: "web_search", result: isExtract ? { success: true, content: text, url: `https://ex.com/p-${s}-${t}` } : { success: true, results: [{ title: `R${t}`, url: `https://ex.com/${s}-${t}` }] } }],
      });
    }
    messages.push({
      id: `asst-resp-${++idx}`, role: "assistant",
      parts: [{ type: "text", text: `Analysis for topic ${letter}: based on the research, here's what I found. `.repeat(20) }],
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
          embeddingConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "qwen/qwen3-embedding-4b",
            dimensions: 1024,
            query_prefix: "Represent this sentence for searching relevant passages: ",
          }}
          rerankerConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "cohere/rerank-4-pro",
          }}
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
          embeddingConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "qwen/qwen3-embedding-4b",
            dimensions: 1024,
            query_prefix: "Represent this sentence for searching relevant passages: ",
          }}
          rerankerConfig={{
            api_key: "storybook-key",
            base_url: "https://openrouter.ai/api/v1",
            model: "cohere/rerank-4-pro",
          }}
        />
      </div>
    </PromptTemplatesProvider>
  );
}

export const RestoredQuestionTool: Story = {
  render: () => <RestoredQuestionToolStory />,
};
