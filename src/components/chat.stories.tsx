import type { Meta, StoryObj } from "@storybook/react-vite";
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
