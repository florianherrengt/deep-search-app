import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@mantine/core";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import {
  AssistantRuntimeStoryProvider,
  setStorybookTauriStores,
} from "@/lib/storybook";
import { PromptTemplateButton } from "./prompt-template-button";

function PromptTemplateButtonStory({ empty }: { empty: boolean }) {
  setStorybookTauriStores({
    "prompt-templates.json": empty
      ? { templates: [], lastSelectedTemplate: null }
      : {
          templates: [
            {
              name: "Research kickoff",
              text: "Search current sources first, then summarize with citations.",
            },
            {
              name: "Long template name that should truncate",
              text: "Compare alternatives and list tradeoffs.",
            },
          ],
          lastSelectedTemplate: "Research kickoff",
        },
  });

  return (
    <AssistantRuntimeStoryProvider>
      <PromptTemplatesProvider key={empty ? "empty" : "filled"}>
        <Box p="md">
          <PromptTemplateButton />
          {empty ? (
            <Text size="sm" c="dimmed">
              No templates render no button.
            </Text>
          ) : null}
        </Box>
      </PromptTemplatesProvider>
    </AssistantRuntimeStoryProvider>
  );
}

const meta = {
  title: "Assistant UI/PromptTemplateButton",
  component: PromptTemplateButton,
  args: {
    empty: false,
  },
  render: (args) => <PromptTemplateButtonStory empty={args.empty} />,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof PromptTemplateButtonStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTemplates: Story = {};

export const Empty: Story = {
  args: {
    empty: true,
  },
};
