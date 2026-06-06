import type { Preview } from "@storybook/react-vite";
import { MantineProvider } from "@mantine/core";
import { theme } from "@/lib/theme";
import "../src/index.css";

const preview: Preview = {
  tags: ["autodocs", "snapshot"],
  decorators: [
    (Story) => (
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <div style={{ minHeight: "100vh", background: "var(--mantine-color-body)" }}>
          <Story />
        </div>
      </MantineProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "app",
      values: [
        { name: "app", value: "var(--mantine-color-body)" },
        { name: "gray", value: "#f8f9fa" },
      ],
    },
    layout: "fullscreen",
  },
};

export default preview;
