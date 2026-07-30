import { useEffect, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { AppUpdateState } from "@/hooks/use-app-update";
import { SettingsProvider } from "@/hooks/use-settings";
import { settingsDefaults, type Settings } from "@/lib/settings-store";
import { setBridgeMock } from "@/lib/tauri-bridge";
import packageJson from "../../package.json";

type StoreSeed = Record<string, Record<string, unknown>>;

type StorybookWindow = Window & {
  __storybookTauriStores?: StoreSeed;
  __storybookAppUpdateState?: AppUpdateState;
};

const storybookChatModel: ChatModelAdapter = {
  async run() {
    return {
      content: [
        {
          type: "text",
          text: "This is a local Storybook response from the browser runtime.",
        },
      ],
    };
  },
};

function cloneStoreSeed(stores: StoreSeed): StoreSeed {
  return JSON.parse(JSON.stringify(stores)) as StoreSeed;
}

export function setStorybookTauriStores(stores: StoreSeed) {
  if (typeof window === "undefined") return;
  const storybookWindow = window as StorybookWindow;
  storybookWindow.__storybookTauriStores = cloneStoreSeed(stores);
  setBridgeMock({
    ...(storybookWindow.__deepSearchBridgeMock ?? {}),
    getAppVersion: async () => packageJson.version,
    loadStore: async (filename, options) => {
      const seededStores = storybookWindow.__storybookTauriStores ?? {};
      seededStores[filename] = {
        ...(options.defaults ?? {}),
        ...(seededStores[filename] ?? {}),
      };
      const data = seededStores[filename];

      return {
        async entries() {
          return Object.entries(data);
        },
        async get<T>(key: string) {
          return (data[key] ?? null) as T | null;
        },
        async set(key: string, value: unknown) {
          data[key] = value;
        },
        async clear() {
          for (const key of Object.keys(data)) delete data[key];
        },
        async save() {},
      };
    },
  });
}

export function withAppUpdateState(state: AppUpdateState): Decorator {
  return (Story) => {
    return (
      <StorybookAppUpdateStateProvider state={state}>
        <Story />
      </StorybookAppUpdateStateProvider>
    );
  };
}

/**
 * Decorator that seeds the Tauri settings store and wraps the story in a
 * `SettingsProvider` so components reading `useSettings()` work in Storybook.
 * Pass a partial settings object to override individual defaults.
 */
export function withSettings(overrides: Partial<Settings> = {}): Decorator {
  return (Story) => {
    setStorybookTauriStores({
      "settings.json": { ...settingsDefaults, ...overrides },
    });
    return (
      <SettingsProvider>
        <Story />
      </SettingsProvider>
    );
  };
}

function StorybookAppUpdateStateProvider({
  state,
  children,
}: {
  state: AppUpdateState;
  children: ReactNode;
}) {
  if (typeof window !== "undefined") {
    const storybookWindow = window as StorybookWindow;
    storybookWindow.__storybookAppUpdateState = state;
    setBridgeMock({
      ...(storybookWindow.__deepSearchBridgeMock ?? {}),
      getAppVersion: async () =>
        "update" in state ? state.update.currentVersion : packageJson.version,
    });
  }

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        delete (window as StorybookWindow).__storybookAppUpdateState;
      }
    };
  }, []);

  return children;
}

export function AssistantRuntimeStoryProvider({
  children,
  initialMessages = [],
}: {
  children: ReactNode;
  initialMessages?: readonly ThreadMessageLike[];
}) {
  const runtime = useLocalRuntime(storybookChatModel, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}

export function withAssistantRuntime(
  initialMessages: readonly ThreadMessageLike[] = [],
): Decorator {
  return (Story) => (
    <AssistantRuntimeStoryProvider initialMessages={initialMessages}>
      <Story />
    </AssistantRuntimeStoryProvider>
  );
}
