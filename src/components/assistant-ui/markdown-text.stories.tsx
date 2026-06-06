import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import {
  AssistantRuntimeStoryProvider,
  setStorybookTauriStores,
} from "@/lib/storybook";
import { Thread } from "./thread";
import { MarkdownText } from "./markdown-text";

const markdownMessages: readonly ThreadMessageLike[] = [
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text:
          "# Markdown coverage\n\nThis response includes a [source link](https://storybook.js.org), inline `code`, a table, and a code block.\n\n| Item | Status |\n| --- | --- |\n| Docs | checked |\n| A11y | enabled |\n\n```ts\nconst framework = '@storybook/react-vite';\n```",
      },
    ],
  },
];

function MarkdownHarness() {
  setStorybookTauriStores({
    "prompt-templates.json": { templates: [], lastSelectedTemplate: null },
  });

  return (
    <AssistantRuntimeStoryProvider initialMessages={markdownMessages}>
      <PromptTemplatesProvider>
        <Box h="560px">
          <Thread
            models={[]}
            selectedModelId=""
            onSelectedModelIdChange={() => undefined}
            tokenCount={860}
          />
        </Box>
      </PromptTemplatesProvider>
    </AssistantRuntimeStoryProvider>
  );
}

const meta = {
  title: "Assistant UI/MarkdownText",
  component: MarkdownText,
  render: () => <MarkdownHarness />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MarkdownText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RichMarkdown: Story = {};
