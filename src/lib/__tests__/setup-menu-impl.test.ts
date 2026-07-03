// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Capture every MenuItem / Submenu built by setupMenu so we can assert the
// View submenu structure and that accelerators are wired to the right actions.
const items = new Map<string, { accelerator?: string; action?: () => void }>();
const submenus = new Map<string, { text: string; items: string[] }>();

vi.mock("@tauri-apps/api/menu", () => ({
  MenuItem: {
    new: async (opts: { id?: string; accelerator?: string; action?: () => void }) => {
      if (opts.id) items.set(opts.id, { accelerator: opts.accelerator, action: opts.action });
      return opts;
    },
  },
  Submenu: {
    new: async (opts: { text: string; items: { id?: string }[] }) => {
      const childIds = opts.items.map((i) => i.id).filter(Boolean) as string[];
      submenus.set(opts.text, { text: opts.text, items: childIds });
      return opts;
    },
  },
  PredefinedMenuItem: {
    new: async () => ({ id: undefined }),
  },
  Menu: {
    new: async () => ({ setAsAppMenu: async () => {} }),
  },
}));

import { setupMenu } from "@/lib/setup-menu-impl";

describe("setupMenu", () => {
  it("builds a View submenu with zoom accelerators bound to the right actions", async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onResetZoom = vi.fn();

    await setupMenu(vi.fn(), vi.fn(), { onZoomIn, onZoomOut, onResetZoom });

    // The View submenu exists and contains exactly the three zoom items.
    const view = submenus.get("View");
    expect(view).toBeDefined();
    expect(view?.items).toEqual(
      expect.arrayContaining(["zoom-in", "zoom-out", "zoom-actual-size"]),
    );

    // Each item has the expected accelerator.
    expect(items.get("zoom-in")?.accelerator).toBe("CmdOrCtrl+=");
    expect(items.get("zoom-out")?.accelerator).toBe("CmdOrCtrl+-");
    expect(items.get("zoom-actual-size")?.accelerator).toBe("CmdOrCtrl+0");

    // Each item's action invokes the right callback.
    items.get("zoom-in")?.action?.();
    items.get("zoom-out")?.action?.();
    items.get("zoom-actual-size")?.action?.();

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });
});
