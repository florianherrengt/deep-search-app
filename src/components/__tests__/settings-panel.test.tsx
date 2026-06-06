import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { SettingsPanel } from "@/components/settings-panel";
import { settingsDefaults } from "@/lib/settings-store";

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    settings: settingsDefaults,
    updateSetting: vi.fn(),
    resetAll: vi.fn(),
  }),
}));

describe("SettingsPanel", () => {
  it("provides its own scroll container inside the clipped tab content area", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <SettingsPanel />
      </MantineProvider>,
    );

    expect(html).toContain("mantine-ScrollArea");
  });
});
