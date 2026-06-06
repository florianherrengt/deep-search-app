import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@mantine/core";
import { GuardrailCard } from "./guardrail-card";

const meta = {
  title: "Assistant UI/GuardrailCard",
  component: GuardrailCard,
  args: {
    event: {
      kind: "research_checkpoint",
      status: "warning",
      title: "Research checkpoint needed",
      message: "The answer includes recent claims but has not saved a checkpoint yet.",
      attempt: 1,
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof GuardrailCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Warning: Story = {};

export const Retrying: Story = {
  args: {
    event: {
      kind: "question_tool",
      status: "retrying",
      title: "Use the questions tool",
      message: "The assistant asked the user directly. Retrying with ask_questions.",
      attempt: 2,
    },
  },
};

export const Passed: Story = {
  args: {
    event: {
      kind: "currency_conversion",
      status: "passed",
      title: "Currency guard passed",
      message: "Prices were converted to the configured reporting currency.",
    },
  },
};

export const LongMessage: Story = {
  args: {
    event: {
      kind: "tool_call_requirement",
      status: "warning",
      title: "Search tool requirement not met",
      message:
        "This response discusses current pricing, model availability, and vendor-specific features. It should run a live search first, cite the sources it opened, and make the uncertainty explicit before answering.",
      attempt: 3,
    },
  },
};

export const InvalidEvent: Story = {
  render: () => (
    <Box p="md" style={{ border: "1px dashed var(--mantine-color-gray-4)", borderRadius: 8 }}>
      <GuardrailCard event={{ status: "unknown" }} />
      <Text size="sm" c="dimmed">
        Invalid guardrail events render nothing.
      </Text>
    </Box>
  ),
};
