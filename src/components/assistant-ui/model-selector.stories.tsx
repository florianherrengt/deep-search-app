import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import { withAssistantRuntime } from "@/lib/storybook";
import { ModelSelector, type ModelOption } from "./model-selector";

const models: ModelOption[] = [
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
  {
    id: "zhipu:glm-4.7-flash",
    name: "Zhipu: glm-4.7-flash",
    description: "Add Zhipu API key in Settings",
    disabled: true,
  },
];

function ControlledSelector(args: ComponentProps<typeof ModelSelector>) {
  const [value, setValue] = useState(args.value ?? models[0].id);
  return (
    <ModelSelector
      {...args}
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        args.onValueChange?.(nextValue);
      }}
    />
  );
}

const meta = {
  title: "Assistant UI/ModelSelector",
  component: ModelSelector,
  decorators: [
    withAssistantRuntime(),
    (Story) => (
      <Box w={420} p="md">
        <Story />
      </Box>
    ),
  ],
  args: {
    models,
    value: models[0].id,
    variant: "default",
    size: "md",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "ghost"],
    },
    size: {
      control: "select",
      options: ["sm", "md"],
    },
  },
  render: (args) => <ControlledSelector {...args} />,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const GhostCompact: Story = {
  args: {
    variant: "ghost",
    size: "sm",
    value: models[1].id,
  },
};

export const LongLabels: Story = {
  args: {
    models: [
      ...models,
      {
        id: "openrouter:vendor%2Fan-extremely-long-model-name-for-overflow-testing",
        name: "OpenRouter: vendor/an-extremely-long-model-name-for-overflow-testing",
        description: "A realistic long model label from a model catalog",
        contextWindowTokens: 1_048_576,
      },
    ],
    value: "openrouter:vendor%2Fan-extremely-long-model-name-for-overflow-testing",
  },
};
