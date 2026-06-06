import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { SkillsProvider } from "@/hooks/use-skills";
import { setStorybookTauriStores } from "@/lib/storybook";
import { SkillsSection } from "./skills-section";

const skillsState = {
  skills: [
    {
      title: "Deep Research",
      slug: "deep-research",
      whenToUse: "Use when facts may be current, vendor-specific, or version-specific.",
      content: "Search first, verify with official sources, and cite what was checked.",
    },
    {
      title: "Human Review Checklist With A Long Title",
      slug: "human-review-checklist-with-a-long-title",
      whenToUse:
        "Use before final delivery to check for unsupported claims, incomplete validation, and unclear residual risk.",
      content: "Review changed files, commands run, and remaining limitations.",
    },
  ],
};

function SkillsStory({ state }: { state: "empty" | "list" }) {
  setStorybookTauriStores({
    "skills.json": state === "list" ? skillsState : { skills: [] },
  });

  return (
    <SkillsProvider key={state}>
      <SkillsSection />
    </SkillsProvider>
  );
}

const meta = {
  title: "Skills/SkillsSection",
  component: SkillsSection,
  args: {
    state: "list",
  },
  argTypes: {
    state: {
      control: "select",
      options: ["empty", "list"],
    },
  },
  render: (args) => <SkillsStory state={args.state} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SkillsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSkills: Story = {};

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
    await userEvent.type(canvas.getByLabelText("Title"), "Source Review");
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
