import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");
const srcDir = path.resolve(rootDir, "src");
const tauriMocks = path.resolve(dirname, "tauri-mocks.ts");
const appUpdateMock = path.resolve(dirname, "use-app-update-mock.ts");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "storybook-addon-vis",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    reactDocgen: "react-docgen-typescript",
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: [
          { find: "@/hooks/use-app-update", replacement: appUpdateMock },
          { find: "@tauri-apps/api/core", replacement: tauriMocks },
          { find: "@tauri-apps/api/path", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-fs", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-http", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-notification", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-opener", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-process", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-shell", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-store", replacement: tauriMocks },
          { find: "@tauri-apps/plugin-updater", replacement: tauriMocks },
          { find: "@", replacement: srcDir },
        ],
      },
    });
  },
};

export default config;
