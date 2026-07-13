import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ToolsPanel } from "./tools-panel";

const configuredToolConfig = {
  researchFolder: "2026-06-06_storybook-integration",
  braveApiKey: "BSA-storybook",
  exaApiKey: "exa-storybook",
  serperApiKey: "serper-storybook",
  tavilyApiKey: "tvly-storybook",
  youtubeApiKey: "AIza-storybook",
  searxngBaseUrl: "http://localhost:8080",
  getChatModel: () => ({
    provider: "openrouter" as const,
    apiKey: "sk-or-storybook",
    model: "openrouter/free",
  }),
};

async function selectSequentialThinking(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const desktopButton = canvas.queryByRole("button", { name: "sequential_thinking" });
  if (desktopButton) {
    await userEvent.click(desktopButton);
    return;
  }

  await userEvent.click(canvas.getByRole("textbox", { name: "Tool" }));
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(await page.findByRole("option", { name: "sequential_thinking" }));
}

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
    await selectSequentialThinking(canvasElement);
    await userEvent.type(canvas.getByLabelText(/thought/i), "Break the research question into source checks.");
  },
};

export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await selectSequentialThinking(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Execute" }));
  },
};

export const ResultAfterExecution: Story = {
  tags: ["skip-screenshot"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await selectSequentialThinking(canvasElement);
    await userEvent.type(canvas.getByLabelText(/thought/i), "Use the latest docs and cite sources.");
    await userEvent.click(canvas.getByRole("button", { name: "Execute" }));
  },
};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 390, height: 844, margin: "0 auto", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
};
