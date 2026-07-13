import { createTheme } from "@mantine/core";

export const theme = createTheme({
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  defaultRadius: "sm",
  primaryColor: "blue",
  primaryShade: { light: 8, dark: 8 },
  focusRing: "auto",
  respectReducedMotion: true,
  cursorType: "pointer",
  colors: {
    dark: [
      "#f4f4f5",
      "#e4e4e7",
      "#d4d4d8",
      "#a1a1aa",
      "#525252",
      "#3a3a3a",
      "#1e1e1e",
      "#141414",
      "#0a0a0a",
      "#000000",
    ],
  },
  headings: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: "600",
    textWrap: "balance",
  },
  components: {
    Button: {
      defaultProps: {
        radius: "sm",
      },
      styles: {
        label: { fontWeight: 600 },
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: "sm",
      },
    },
    Paper: {
      defaultProps: {
        radius: "sm",
      },
    },
    Modal: {
      defaultProps: {
        radius: "md",
        overlayProps: { backgroundOpacity: 0.45 },
      },
    },
    Drawer: {
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.45 },
      },
    },
    Tooltip: {
      defaultProps: {
        openDelay: 500,
      },
    },
  },
});
