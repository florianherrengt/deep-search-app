import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  settingsStore,
  settingsSchema,
  settingsDefaults,
} from "@/lib/settings-store";

export type Settings = z.infer<typeof settingsSchema>;

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  updateSetting: (key: keyof Settings, value: string) => Promise<void>;
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
    async (key: keyof Settings, value: string) => {
      await settingsStore.set(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetAll = useCallback(async () => {
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
    const raw = window.localStorage.getItem("deep-search-test-settings");
    if (!raw) return null;
    return settingsSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
