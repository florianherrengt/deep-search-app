import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
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
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  resetAll: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(settingsDefaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const testSettings = getDevTestSettings();
        if (testSettings) {
          setSettings(testSettings);
          return;
        }
        setSettings(await settingsStore.get());
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (hasDevTestSettings()) {
        setSettings((prev) => {
          const next = settingsSchema.parse({ ...prev, [key]: value });
          window.localStorage.setItem(
            DEV_TEST_SETTINGS_KEY,
            JSON.stringify(next),
          );
          return next;
        });
        return;
      }

      await settingsStore.set(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetAll = useCallback(async () => {
    if (hasDevTestSettings()) {
      window.localStorage.setItem(
        DEV_TEST_SETTINGS_KEY,
        JSON.stringify(settingsDefaults),
      );
      setSettings(settingsDefaults);
      return;
    }

    await settingsStore.reset();
    setSettings(settingsDefaults);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, resetAll }}>
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
