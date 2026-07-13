// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsStoreMocks = vi.hoisted(() => ({
  get: vi.fn(),
  reset: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings-store")>();
  return {
    ...actual,
    settingsStore: settingsStoreMocks,
  };
});

import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { settingsDefaults, type Settings } from "@/lib/settings-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let latestSettingsContext: ReturnType<typeof useSettings> | null = null;
let contentMounts = 0;

function PersistentContent({ currency }: { currency: Settings["currency"] }) {
  useEffect(() => {
    contentMounts += 1;
  }, []);

  return <div data-testid="content">Currency: {currency}</div>;
}

function AppLikeConsumer() {
  const context = useSettings();
  latestSettingsContext = context;

  if (context.loading) return <div data-testid="loading">Loading</div>;
  if (context.error) return <div data-testid="error">Error</div>;

  return <PersistentContent currency={context.settings.currency} />;
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    latestSettingsContext = null;
    contentMounts = 0;
    settingsStoreMocks.get.mockReset();
    settingsStoreMocks.reset.mockReset().mockResolvedValue(undefined);
    settingsStoreMocks.set.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("persists an update without unmounting hydrated consumers during reload", async () => {
    const refreshedSettings = {
      ...settingsDefaults,
      currency: "EUR",
    } satisfies Settings;
    const refresh = deferred<Settings>();
    settingsStoreMocks.get
      .mockResolvedValueOnce(settingsDefaults)
      .mockReturnValueOnce(refresh.promise);

    render(
      <SettingsProvider>
        <AppLikeConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("content").textContent).toBe("Currency: USD");
    });
    expect(contentMounts).toBe(1);

    let updatePromise: Promise<void> | undefined;
    await act(async () => {
      updatePromise = latestSettingsContext?.updateSetting("currency", "EUR");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(settingsStoreMocks.get).toHaveBeenCalledTimes(2);
    });
    expect(settingsStoreMocks.set).toHaveBeenCalledWith("currency", "EUR");
    expect(screen.queryByTestId("loading")).toBeNull();
    expect(screen.getByTestId("content").textContent).toBe("Currency: USD");
    expect(contentMounts).toBe(1);

    await act(async () => {
      refresh.resolve(refreshedSettings);
      await updatePromise;
    });

    expect(screen.getByTestId("content").textContent).toBe("Currency: EUR");
    expect(contentMounts).toBe(1);
  });

  it("keeps hydrated consumers mounted when the reload fails", async () => {
    settingsStoreMocks.get
      .mockResolvedValueOnce(settingsDefaults)
      .mockRejectedValueOnce(new Error("reload failed"));

    render(
      <SettingsProvider>
        <AppLikeConsumer />
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("content").textContent).toBe("Currency: USD");
    });

    await act(async () => {
      await latestSettingsContext?.updateSetting("currency", "EUR");
    });

    expect(screen.queryByTestId("error")).toBeNull();
    expect(screen.getByTestId("content").textContent).toBe("Currency: USD");
    expect(contentMounts).toBe(1);
  });
});
