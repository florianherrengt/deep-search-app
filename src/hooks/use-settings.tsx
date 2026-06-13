import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useAsyncResource } from "./use-async-resource";
import {
  settingsStore,
  settingsSchema,
  settingsDefaults,
  type Settings,
} from "@/lib/settings-store";
import { tryParseJson } from "@/lib/json";

export type { Settings };

const DEV_TEST_SETTINGS_KEY = "deep-search-test-settings";

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  error: Error | null;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  resetAll: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: settings, loading, error, refresh } = useAsyncResource(
    settingsDefaults,
    async () => {
      const testSettings = getDevTestSettings();
      if (testSettings) return testSettings;
      return settingsStore.get();
    },
  );

  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (hasDevTestSettings()) {
        const prev = getDevTestSettings() ?? settingsDefaults;
        const next = settingsSchema.parse({ ...prev, [key]: value });
        window.localStorage.setItem(
          DEV_TEST_SETTINGS_KEY,
          JSON.stringify(next),
        );
        await refresh();
        return;
      }

      await settingsStore.set(key, value);
      await refresh();
    },
    [refresh],
  );

  const resetAll = useCallback(async () => {
    if (hasDevTestSettings()) {
      window.localStorage.setItem(
        DEV_TEST_SETTINGS_KEY,
        JSON.stringify(settingsDefaults),
      );
      await refresh();
      return;
    }

    await settingsStore.reset();
    await refresh();
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, error, updateSetting, resetAll }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

function getDevTestSettings(): Settings | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(DEV_TEST_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = tryParseJson(raw);
    return settingsSchema.parse({
      ...settingsDefaults,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    });
  } catch {
    return null;
  }
}

function hasDevTestSettings() {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem(DEV_TEST_SETTINGS_KEY) !== null
  );
}
