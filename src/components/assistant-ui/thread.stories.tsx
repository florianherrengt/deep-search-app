import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { Box } from "@mantine/core";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import {
  AssistantRuntimeStoryProvider,
  setStorybookTauriStores,
} from "@/lib/storybook";
import { QuestionsToolUI } from "./questions-tool";
import { Thread } from "./thread";

type ThreadStoryArgs = ComponentProps<typeof Thread> & {
  initialMessages: readonly ThreadMessageLike[];
};

const models = [
  {
    id: "openrouter:openrouter%2Ffree",
    name: "OpenRouter: openrouter/free",
    description: "OpenRouter",
    contextWindowTokens: 64_000,
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    name: "Anthropic: claude-sonnet-4-5",
    description: "Anthropic",
    contextWindowTokens: 200_000,
  },
];

const conversationMessages: readonly ThreadMessageLike[] = [
  {
    role: "user",
    content: "Compare the current Storybook setup options for this app.",
  },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Need to verify current package names, then map them to the existing React/Vite/Mantine app conventions.",
      },
      {
        type: "tool-call",
        toolCallId: "tool-search-1",
        toolName: "brave_search",
        args: { query: "Storybook React Vite docs 2026", count: 5 },
        argsText: '{"query":"Storybook React Vite docs 2026","count":5}',
        result: {
          results: [
            { title: "React Vite framework docs", url: "https://storybook.js.org/docs" },
          ],
        },
      },
      {
        type: "data",
        name: "guardrail_event",
        data: {
          kind: "tool_call_requirement",
          status: "passed",
          title: "Current docs checked",
          message: "Storybook package guidance was verified before configuring the app.",
        },
      },
      {
        type: "data",
        name: "agent_diagnostic",
        data: {
          kind: "empty_response",
          status: "info",
          title: "Diagnostic example",
          message: "Diagnostics render inline with assistant messages.",
        },
      },
      {
        type: "text",
        text:
          "## Recommendation\n\nUse `@storybook/react-vite` with the app's Mantine provider and `@/*` alias.\n\n| Area | Choice |\n| --- | --- |\n| Builder | Vite |\n| Theme | Existing Mantine theme |\n| Runtime | Browser only |",
      },
    ],
  },
];

const questionToolMessages: readonly ThreadMessageLike[] = [
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "tool-question-1",
        toolName: "ask_questions",
        args: {
          questions: [
            {
              question: "Which visual review state should be prioritized?",
              candidates: [
                { label: "Settings", value: "settings" },
                { label: "Research sidebar", value: "research-sidebar" },
                { label: "Assistant thread", value: "thread" },
              ],
            },
          ],
        },
        argsText: "",
      },
    ],
  },
];

function ThreadStory({ initialMessages, ...args }: ThreadStoryArgs) {
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
    <AssistantRuntimeStoryProvider initialMessages={initialMessages}>
      <PromptTemplatesProvider>
        <QuestionsToolUI />
        <Box h="680px">
          <Thread {...args} />
        </Box>
      </PromptTemplatesProvider>
    </AssistantRuntimeStoryProvider>
  );
}

const meta = {
  title: "Assistant UI/Thread",
  component: Thread,
  args: {
    models,
    selectedModelId: models[0].id,
    onSelectedModelIdChange: () => undefined,
    tokenCount: 12_800,
    initialMessages: conversationMessages,
  },
  render: (args) => <ThreadStory {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<ThreadStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  tags: ["!snapshot"],
};

export const Empty: Story = {
  args: {
    initialMessages: [],
    tokenCount: 0,
  },
};

export const WithQuestionTool: Story = {
  args: {
    initialMessages: questionToolMessages,
  },
};

export const HighTokenCount: Story = {
  args: {
    tokenCount: 58_400,
  },
};
