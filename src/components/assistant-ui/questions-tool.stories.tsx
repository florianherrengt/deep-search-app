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

const pendingQuestionMessages: readonly ThreadMessageLike[] = [
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "question-tool-pending",
        toolName: "ask_questions",
        args: {
          questions: [
            {
              question: "Which area should the review prioritize?",
              candidates: [
                { label: "A11y", value: "a11y" },
                { label: "Responsive states", value: "responsive" },
                { label: "Tool output", value: "tool-output" },
              ],
            },
            {
              question: "How broad should the component inventory be?",
              candidates: [
                { label: "Core panels", value: "core-panels" },
                { label: "Everything reusable", value: "all-reusable" },
              ],
            },
          ],
        },
        argsText: "",
      },
    ],
  },
];

const completedQuestionMessages: readonly ThreadMessageLike[] = [
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "question-tool-complete",
        toolName: "ask_questions",
        args: {
          questions: [
            {
              question: "Which visual state matters most?",
              candidates: [{ label: "Empty states", value: "empty" }],
            },
          ],
        },
        argsText: "",
        result: {
          answers: [
            {
              question: "Which visual state matters most?",
              answer: "Empty states and errors",
              custom: true,
            },
          ],
        },
      },
    ],
  },
];

function QuestionsToolHarness({
  initialMessages,
}: {
  initialMessages: readonly ThreadMessageLike[];
}) {
  setStorybookTauriStores({
    "prompt-templates.json": { templates: [], lastSelectedTemplate: null },
  });

  return (
    <AssistantRuntimeStoryProvider initialMessages={initialMessages}>
      <PromptTemplatesProvider>
        <QuestionsToolUI />
        <Box h="560px">
          <Thread
            models={[]}
            selectedModelId=""
            onSelectedModelIdChange={() => undefined}
            tokenCount={0}
          />
        </Box>
      </PromptTemplatesProvider>
    </AssistantRuntimeStoryProvider>
  );
}

const meta = {
  title: "Assistant UI/QuestionsToolUI",
  component: QuestionsToolUI,
  args: {
    initialMessages: pendingQuestionMessages,
  },
  render: (args) => <QuestionsToolHarness initialMessages={args.initialMessages} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof QuestionsToolHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  tags: ["!snapshot"],
};

export const Completed: Story = {
  args: {
    initialMessages: completedQuestionMessages,
  },
};
