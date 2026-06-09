import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextWindowBadge } from "./context-window-badge";

const meta = {
  title: "Assistant UI/ContextWindowBadge",
  component: ContextWindowBadge,
  argTypes: {
    tokenCount: { control: "number" },
  },
} satisfies Meta<typeof ContextWindowBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    model: {
      id: "anthropic:claude-sonnet-4-5",
      name: "Anthropic: claude-sonnet-4-5",
      contextWindowTokens: 200_000,
    },
    tokenCount: 12_800,
  },
};

export const ZeroTokens: Story = {
  args: {
    model: {
      id: "anthropic:claude-sonnet-4-5",
      name: "Anthropic: claude-sonnet-4-5",
      contextWindowTokens: 200_000,
    },
    tokenCount: 0,
  },
};

export const HighTokenCount: Story = {
  args: {
    model: {
      id: "anthropic:claude-sonnet-4-5",
      name: "Anthropic: claude-sonnet-4-5",
      contextWindowTokens: 200_000,
    },
    tokenCount: 185_000,
  },
};

export const NoModel: Story = {
  args: {
    model: undefined,
    tokenCount: 5_200,
  },
};

export const UnknownContextWindow: Story = {
  args: {
    model: {
      id: "openrouter:unknown-model",
      name: "Unknown Model",
    },
    tokenCount: 3_400,
  },
};

export const SmallContext: Story = {
  args: {
    model: {
      id: "openrouter:small-model",
      name: "Small Model",
      contextWindowTokens: 4_096,
    },
    tokenCount: 2_100,
  },
};
