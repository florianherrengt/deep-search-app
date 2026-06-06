import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PromptTemplatesProvider } from "@/hooks/use-prompt-templates";
import { setStorybookTauriStores } from "@/lib/storybook";
import { PromptTemplatesSection } from "./prompt-templates-section";

const templateState = {
  templates: [
    {
      name: "Deep research kickoff",
      text: "Research the current state of the topic. Verify all version-specific claims with official sources and list uncertainty explicitly.",
    },
    {
      name: "Compare vendors with long overflow text",
      text: "Compare pricing, API limits, documentation quality, and operational risks. Include a concise recommendation at the end.",
    },
  ],
  lastSelectedTemplate: "Deep research kickoff",
};

function PromptTemplatesStory({ state }: { state: "empty" | "list" }) {
  setStorybookTauriStores({
    "prompt-templates.json": state === "list" ? templateState : {
      templates: [],
      lastSelectedTemplate: null,
    },
  });

  return (
    <PromptTemplatesProvider key={state}>
      <PromptTemplatesSection />
    </PromptTemplatesProvider>
  );
}

const meta = {
  title: "Prompts/PromptTemplatesSection",
  component: PromptTemplatesSection,
  args: {
    state: "list",
  },
  argTypes: {
    state: {
      control: "select",
      options: ["empty", "list"],
    },
  },
  render: (args) => <PromptTemplatesStory state={args.state} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PromptTemplatesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTemplates: Story = {};

export const Empty: Story = {
  args: {
    state: "empty",
  },
};

export const AddForm: Story = {
  args: {
    state: "empty",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
  },
};

export const ValidationError: Story = {
  args: {
    state: "empty",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Add" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};
