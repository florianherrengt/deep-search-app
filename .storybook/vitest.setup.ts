import { beforeEach } from "vitest";
import { vis } from "storybook-addon-vis/vitest-setup";
import { setBridgeMock, type StoreOptions } from "@/lib/tauri-bridge";

type StoreSeed = Record<string, Record<string, unknown>>;

declare global {
  interface Window {
    __storybookTauriStores?: StoreSeed;
  }
}

function getStores(): StoreSeed {
  window.__storybookTauriStores ??= {};
  return window.__storybookTauriStores;
}

function getStore(filename: string, defaults?: Record<string, unknown>) {
  const stores = getStores();
  stores[filename] = {
    ...(defaults ?? {}),
    ...(stores[filename] ?? {}),
  };
  return stores[filename];
}

beforeEach(() => {
  setBridgeMock({
    loadStore: async (filename: string, options: StoreOptions) => {
      const data = getStore(filename, options.defaults);
      return {
        async get<T>(key: string) {
          return (data[key] ?? null) as T | null;
        },
        async set(key: string, value: unknown) {
          data[key] = value;
        },
        async save() {},
      };
    },
    invoke: async () => null,
    exists: async () => false,
    readTextFile: async () => "",
    writeTextFile: async () => {},
    mkdir: async () => {},
    appDataDir: async () => "/storybook/app-data",
    join: async (...paths: string[]) => paths.join("/").replace(/\/+/g, "/"),
    sendNotification: () => {},
    checkForUpdate: async () => null,
    relaunchApp: async () => {},
  });
});

vis.setup({ auto: false });
