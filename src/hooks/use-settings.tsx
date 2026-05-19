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
  updateSetting: (key: keyof Settings, value: string | null) => Promise<void>;
  resetAll: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(settingsDefaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setSettings(await settingsStore.get());
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateSetting = useCallback(
    async (key: keyof Settings, value: string | null) => {
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
