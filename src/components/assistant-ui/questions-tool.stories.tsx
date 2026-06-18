import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { Box, SimpleGrid, Stack, Text } from "@mantine/core";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import {
  AssistantRuntimeStoryProvider,
  setStorybookTauriStores,
} from "@/lib/storybook";
import { QuestionsToolUI, QuestionsToolView } from "./questions-tool";
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
            {
              question: "Should completed answers remain visible?",
              answer: "yes",
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
            previousSearches={[]}
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

const visualReviewArgs = {
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
};

const visualReviewResult = {
  answers: [
    {
      question: "Which area should the review prioritize?",
      answer: "Tool output",
    },
    {
      question: "How broad should the component inventory be?",
      answer: "Settings, assistant thread, and reusable cards",
      custom: true,
    },
  ],
};

function VisualStatesStory() {
  const schemes = ["light", "dark"] as const;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={0}>
      {schemes.map((scheme) => (
        <Box
          key={scheme}
          data-mantine-color-scheme={scheme}
          p="md"
          mih="100vh"
          style={{
            backgroundColor:
              scheme === "dark"
                ? "var(--mantine-color-dark-7)"
                : "var(--mantine-color-gray-0)",
          }}
        >
          <Stack gap="sm">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">
              {scheme}
            </Text>
            <QuestionsToolView
              args={visualReviewArgs}
              onSubmit={() => undefined}
            />
            <QuestionsToolView
              args={visualReviewArgs}
              result={visualReviewResult}
            />
          </Stack>
        </Box>
      ))}
    </SimpleGrid>
  );
}

export const VisualStates: Story = {
  render: () => <VisualStatesStory />,
};
