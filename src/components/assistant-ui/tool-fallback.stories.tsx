import { useLayoutEffect, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ToolFallback } from "./tool-fallback";
import { useSubAgentActions } from "@/lib/sub-agent-store";

const meta = {
  title: "Assistant UI/ToolFallback",
  component: ToolFallback,
  args: {
    toolName: "brave_search",
    status: "complete",
    args: { query: "current AI browser automation tools", count: 5 },
    result: {
      results: [
        { title: "Official documentation", url: "https://example.com/docs" },
        { title: "Release notes", url: "https://example.com/releases" },
      ],
    },
  },
  argTypes: {
    status: {
      control: "select",
      options: ["running", "complete", "error"],
    },
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ToolFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};

export const Running: Story = {
  args: {
    status: "running",
    result: undefined,
  },
};

export const Error: Story = {
  args: {
    status: "error",
    toolName: "extract_page_content",
    args: { url: "https://example.com/very/long/path/to/research-paper" },
    result: "Could not extract page content: request timed out after 30s.",
  },
};

export const WithoutDetails: Story = {
  args: {
    toolName: "research_checkpoint",
    status: "complete",
    args: undefined,
    result: undefined,
  },
};

export const LongJson: Story = {
  args: {
    toolName: "search_research",
    status: "complete",
    args: {
      query:
        "Find the most relevant chunks about battery policy, certification, and aircraft restrictions",
      limit: 10,
    },
    result: {
      matches: Array.from({ length: 4 }, (_, index) => ({
        folder: "2026-06-06_power-bank-flight-rules",
        file: `source-${index + 1}.md`,
        score: 0.91 - index * 0.04,
        excerpt:
          "Long extracted content is wrapped inside the fallback details panel so tool output remains inspectable without breaking the chat layout.",
      })),
    },
  },
};

function StreamingSubAgentToolFallback(
  args: ComponentProps<typeof ToolFallback>,
) {
  const { processEvent } = useSubAgentActions();

  useLayoutEffect(() => {
    processEvent("storybook-chat", {
      type: "start",
      id: "storybook-plan-agent",
      source: "sub-agent",
      name: "Research Plan",
      toolName: "create_research_plan",
      parentMessageId: "storybook-message",
      displayTarget: {
        type: "toolCall",
        toolCallId: "storybook-plan-call",
      },
    });
    processEvent("storybook-chat", {
      type: "text-delta",
      id: "storybook-plan-agent",
      delta:
        "# Research plan\n\n- Check official docs\n- Compare release notes\n- Verify open issues",
    });
  }, [processEvent]);

  return <ToolFallback {...args} />;
}

export const ExpandedWithStreamingSubAgent: Story = {
  args: {
    toolName: "create_research_plan",
    status: "running",
    args: { query: "Compare current AI browser automation tools" },
    result: undefined,
    chatId: "storybook-chat",
    toolCallId: "storybook-plan-call",
  },
  render: (args) => <StreamingSubAgentToolFallback {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByLabelText(/expand.*create_research_plan/i),
    );
  },
};
