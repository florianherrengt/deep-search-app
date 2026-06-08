import { createTheme } from "@mantine/core";

export const theme = createTheme({
  fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
  defaultRadius: "md",
  primaryColor: "dark",
  colors: {
    dark: [
      "#e8e8e8",
      "#c8c8c8",
      "#a0a0a0",
      "#808080",
      "#525252",
      "#3a3a3a",
      "#1e1e1e",
      "#141414",
      "#0a0a0a",
      "#000000",
    ],
  },
  headings: {
    fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
  },
  other: {
    sidebarWidth: 256,
    contentPaddingX: 24,
    iconSizeSm: 12,
    iconSizeMd: 14,
    iconSizeLg: 16,
  },
  components: {
    Paper: {
      defaultProps: {
        radius: "md",
      },
    },
  },
});
