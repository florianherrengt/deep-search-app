// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { SettingsFields } from "@/components/settings-fields";
import { settingsDefaults } from "@/lib/settings-store";

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

function renderSettingsFields() {
  return render(
    <MantineProvider>
      <SettingsFields settings={settingsDefaults} updateSetting={vi.fn()} />
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
    expect(screen.getByText("Ready to Use")).toBeTruthy();
  });
});
