import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@mantine/core";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningTrigger,
} from "./reasoning";

type ReasoningStoryArgs = ComponentProps<typeof ReasoningRoot> & {
  active?: boolean;
  duration?: number;
};

function ReasoningExample({ active, duration, ...args }: ReasoningStoryArgs) {
  const [open, setOpen] = useState(args.defaultOpen ?? false);

  return (
    <ReasoningRoot {...args} open={open} onOpenChange={setOpen}>
      <ReasoningTrigger
        active={active}
        duration={duration}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <ReasoningContent>
          <Text size="sm" c="dimmed">
            Checked the saved research folder, compared conflicting source dates,
            and verified that the final answer should mention uncertainty around
            vendor roadmaps.
          </Text>
        </ReasoningContent>
      ) : null}
    </ReasoningRoot>
  );
}

const meta = {
  title: "Assistant UI/Reasoning",
  component: ReasoningRoot,
  args: {
    defaultOpen: true,
    variant: "outline",
    active: false,
    duration: 12,
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["outline", "ghost", "muted"],
    },
  },
  render: (args) => <ReasoningExample {...args} />,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<ReasoningStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
};

export const ActiveThinking: Story = {
  args: {
    active: true,
    duration: undefined,
  },
};

export const Muted: Story = {
  args: {
    variant: "muted",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
  },
};
