import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ToolsPanel } from "./tools-panel";

const configuredToolConfig = {
  researchFolder: "2026-06-06_storybook-integration",
  braveApiKey: "BSA-storybook",
  exaApiKey: "exa-storybook",
  serperApiKey: "serper-storybook",
  tavilyApiKey: "tvly-storybook",
  searxngBaseUrl: "http://localhost:8080",
  getChatModel: () => ({
    provider: "openrouter" as const,
    apiKey: "sk-or-storybook",
    model: "openrouter/free",
  }),
};

const meta = {
  title: "Tools/ToolsPanel",
  component: ToolsPanel,
  args: {
    config: configuredToolConfig,
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ToolsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Configured: Story = {};

export const NoConfig: Story = {
  args: {
    config: undefined,
  },
};

export const SelectedTool: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "sequential_thinking" }));
    await userEvent.type(canvas.getByLabelText(/thought/i), "Break the research question into source checks.");
  },
};

export const ResultAfterExecution: Story = {
  tags: ["skip-screenshot"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "sequential_thinking" }));
    await userEvent.type(canvas.getByLabelText(/thought/i), "Use the latest docs and cite sources.");
    await userEvent.click(canvas.getByRole("button", { name: "Execute" }));
  },
};
