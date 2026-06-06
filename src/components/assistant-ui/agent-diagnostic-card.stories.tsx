import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@mantine/core";
import { AgentDiagnosticCard } from "./agent-diagnostic-card";

const meta = {
  title: "Assistant UI/AgentDiagnosticCard",
  component: AgentDiagnosticCard,
  args: {
    event: {
      kind: "empty_response",
      status: "info",
      title: "Assistant returned an empty step",
      message: "The transport received no visible assistant content for this step.",
      finishReason: "stop",
      toolCallCount: 0,
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof AgentDiagnosticCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const WarningWithReason: Story = {
  args: {
    event: {
      kind: "empty_response",
      status: "warning",
      title: "No answer after tool calls",
      message: "The model produced tool calls but no final text response.",
      reason:
        "finishReason=tool-calls, toolCallCount=3. The guarded stream will continue to request a visible answer.",
      finishReason: "tool-calls",
      toolCallCount: 3,
    },
  },
};

export const LongReason: Story = {
  args: {
    event: {
      kind: "empty_response",
      status: "warning",
      title: "Repeated empty response",
      message:
        "The model returned multiple empty assistant steps while attempting to recover from a tool-call-heavy answer.",
      reason:
        "This can happen when the provider reports a successful stop but the content parts are empty. The UI keeps the diagnostic compact while preserving the reason text for debugging.",
    },
  },
};

export const InvalidEvent: Story = {
  render: () => (
    <Box p="md" style={{ border: "1px dashed var(--mantine-color-gray-4)", borderRadius: 8 }}>
      <AgentDiagnosticCard event={{ kind: "different_event" }} />
      <Text size="sm" c="dimmed">
        Invalid diagnostic events render nothing.
      </Text>
    </Box>
  ),
};
