// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});
import { MantineProvider } from "@mantine/core";
import { SettingsFields } from "@/components/settings-fields";
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

describe("SettingsFields", () => {
  it("keeps the current provider when the active option is selected again", () => {
    renderSettingsFields();

    const providerInput = getProviderInput();
    fireEvent.click(providerInput);
    fireEvent.click(screen.getByRole("option", { name: "OpenRouter" }));

    expect(providerInput.value).toBe("OpenRouter");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
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

describe("handleCommit for number fields", () => {
  it("parses number value for embedding_dimensions and calls updateSetting", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "2048" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).toHaveBeenCalledWith("embedding_dimensions", 2048);
  });

  it("does not call updateSetting when non-numeric input is entered for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when unchanged number value is committed", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "1024" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when empty value is committed for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when whitespace value is committed for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "   " } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when decimal value is committed for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "10.5" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when negative value is committed for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "-5" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("does not call updateSetting when zero is committed for a number field", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderSettingsFields({
      settings: { embedding_dimensions: 1024 },
      updateSetting: updateSetting as never,
    });

    const allLabels = screen.getAllByText("Dimensions");
    const dimLabel = allLabels[allLabels.length - 1];
    const forAttr = dimLabel.getAttribute("for");
    if (!forAttr) throw new Error("Label missing 'for' attribute");
    const input = document.getElementById(forAttr);
    if (!(input instanceof HTMLInputElement)) throw new Error("Input not found");

    fireEvent.change(input, { target: { value: "0" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(updateSetting).not.toHaveBeenCalled();
  });
});
