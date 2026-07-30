// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tauriRuntime = vi.hoisted(() => ({
  enabled: false,
  appVersion: "0.1.0-beta.4",
}));

// SettingsUpdateSection reads settings via useSettings(); SettingsFields takes
// them as props. This mock controls the hook side for the update-section tests.
const settingsMock = vi.hoisted(() => ({
  settings: {} as Partial<Settings>,
  updateSetting: vi.fn(),
}));

vi.mock("@/hooks/use-settings", async () => {
  const { settingsDefaults } = await import("@/lib/settings-store");
  return {
    useSettings: () => ({
      settings: { ...settingsDefaults, ...settingsMock.settings },
      updateSetting: settingsMock.updateSetting,
      resetAll: vi.fn(),
    }),
  };
});

vi.mock("@/lib/tauri-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri-bridge")>(
    "@/lib/tauri-bridge",
  );
  return {
    ...actual,
    isTauri: () => tauriRuntime.enabled,
    getAppVersion: vi.fn(async () => tauriRuntime.appVersion),
    resolveNodePath: vi.fn(async () => ({
      path: "/usr/local/bin/node",
      dir: "/usr/local/bin",
      version: "v22.12.0",
      envPath: "/usr/local/bin:/usr/bin",
    })),
  };
});

beforeEach(() => {
  tauriRuntime.enabled = false;
  settingsMock.settings = {};
  settingsMock.updateSetting = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});
import { MantineProvider } from "@mantine/core";
import {
  SettingsFields,
  SettingsUpdateSection,
} from "@/components/settings-fields";
import { settingsDefaults } from "@/lib/settings-store";
import type { Settings } from "@/hooks/use-settings";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
function renderSettingsFields(overrides?: {
  settings?: Partial<Settings>;
  updateSetting?: (key: keyof Settings, value: unknown) => Promise<void>;
}) {
  return render(
    <MantineProvider>
      <SettingsFields
        settings={{ ...settingsDefaults, ...overrides?.settings }}
        updateSetting={overrides?.updateSetting ?? (vi.fn() as never)}
      />
    </MantineProvider>,
  );
}

function getProviderInput() {
  const input = screen
    .getAllByLabelText("Provider")
    .find((element): element is HTMLInputElement => element instanceof HTMLInputElement);

  if (!input) {
    throw new Error("Provider input not found");
  }

  return input;
}

describe("SettingsUpdateSection", () => {
  it("shows the running app version in the update section", async () => {
    render(
      <MantineProvider>
        <SettingsUpdateSection />
      </MantineProvider>,
    );

    expect(await screen.findByText("0.1.0-beta.4")).toBeTruthy();
  });

  it("renders the auto-download toggle unchecked by default", () => {
    render(
      <MantineProvider>
        <SettingsUpdateSection />
      </MantineProvider>,
    );

    const toggle = screen.getByRole("switch", {
      name: /Automatically download updates/i,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("calls updateSetting when the auto-download toggle is switched on", () => {
    render(
      <MantineProvider>
        <SettingsUpdateSection />
      </MantineProvider>,
    );

    const toggle = screen.getByRole("switch", {
      name: /Automatically download updates/i,
    }) as HTMLInputElement;
    fireEvent.click(toggle);

    expect(settingsMock.updateSetting).toHaveBeenCalledWith(
      "auto_download_updates",
      true,
    );
  });

  it("reflects the persisted auto-download setting when enabled", () => {
    settingsMock.settings = { auto_download_updates: true };

    render(
      <MantineProvider>
        <SettingsUpdateSection />
      </MantineProvider>,
    );

    const toggle = screen.getByRole("switch", {
      name: /Automatically download updates/i,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });
});

describe("SettingsFields", () => {

  it("keeps the current provider when the active option is selected again", () => {
    renderSettingsFields();

    const providerInput = getProviderInput();
    fireEvent.click(providerInput);
    fireEvent.click(screen.getByRole("option", { name: "OpenRouter" }));

    expect(providerInput.value).toBe("OpenRouter");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("renders currency conversion target with a disabled option", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { currency: "USD" },
      updateSetting: updateSetting as never,
    });

    const currencyInput = screen
      .getAllByLabelText("Currency conversion tool target")
      .find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(currencyInput).toBeTruthy();
    expect(currencyInput!.value).toBe("USD");

    fireEvent.click(currencyInput!);
    fireEvent.click(await screen.findByRole("option", { name: "Disabled" }));

    expect(updateSetting).toHaveBeenCalledWith("currency", "disabled");
  });

  it("does not call updateSetting for currency with a null value", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { currency: "USD" },
      updateSetting: updateSetting as never,
    });

    const currencyInput = screen
      .getAllByLabelText("Currency conversion tool target")
      .find((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(currencyInput).toBeTruthy();

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("renders Scrape.do API key setting", () => {
    renderSettingsFields();

    expect(screen.getByLabelText("Scrape.do API Key")).toBeTruthy();
  });

  it("renders YouTube subtitle fallback setting", () => {
    renderSettingsFields();

    expect(screen.getByLabelText("yt-dlp Path")).toBeTruthy();
  });

  it("renders YouTube Data API key setting", () => {
    renderSettingsFields();

    expect(screen.getByLabelText("YouTube Data API Key")).toBeTruthy();
  });

  it("enables browser-backed Google search by default and lets users disable it", () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({ updateSetting: updateSetting as never });

    const checkbox = screen.getByRole("checkbox", {
      name: /Browser-backed Google Search/i,
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);

    expect(updateSetting).toHaveBeenCalledWith("google_search_enabled", false);
  });

  it("explains that the selected browser powers direct Google search", () => {
    tauriRuntime.enabled = true;
    renderSettingsFields({
      settings: { chrome_devtools_mcp_enabled: true },
    });

    expect(
      screen.getByText(/selected browser powers direct Google search/i),
    ).toBeTruthy();
  });

  it("states that browser-backed Google search requires the desktop app outside Tauri", () => {
    renderSettingsFields();

    expect(
      screen.getByText(/browser-backed Google search is available in the desktop app/i),
    ).toBeTruthy();
    expect(
      screen.queryByText(/built-in Tauri webview powers direct Google search/i),
    ).toBeNull();
  });

  it("explains when browser-backed Google search is disabled", () => {
    tauriRuntime.enabled = true;
    renderSettingsFields({
      settings: { google_search_enabled: false },
    });

    expect(
      screen.getByText(/Browser-backed Google Search is disabled above/i),
    ).toBeTruthy();
  });

  it("renders the Deep Search MCP setup section", () => {
    renderSettingsFields();

    expect(screen.getByText("Deep Search MCP")).toBeTruthy();
    expect(screen.getByLabelText("MCP proxy path")).toBeTruthy();
  });

  it("does not save provider fields on blur, only on Save button click", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({ updateSetting: updateSetting as never });

    const modelLabel = screen.getByText("Model");
    const modelInput = document.getElementById(
      modelLabel.getAttribute("for")!,
    ) as HTMLInputElement;

    fireEvent.change(modelInput, { target: { value: "gpt-4o" } });
    await act(async () => {
      fireEvent.blur(modelInput);
    });

    expect(updateSetting).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(updateSetting).toHaveBeenCalledWith("default_model", "gpt-4o");
  });
});
