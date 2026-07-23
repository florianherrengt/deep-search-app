// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: invokeMock,
}));

import { useBrowserTabs } from "@/hooks/use-browser-tabs";
import {
  emitBrowserTabOpened,
  emitBrowserTabVerificationCleared,
  emitBrowserTabVerificationRequired,
} from "@/lib/browser-tab-events";

afterEach(() => {
  cleanup();
  invokeMock.mockClear();
});

describe("useBrowserTabs verification attention", () => {
  it("sets and clears attention without switching the active tab", () => {
    const { result } = renderHook(() => useBrowserTabs());

    act(() => {
      emitBrowserTabOpened({
        id: "search-tab",
        url: "https://www.google.com/search?q=test",
        title: "Google Search",
        activate: false,
      });
      emitBrowserTabVerificationRequired({ id: "search-tab" });
    });

    expect(result.current.tabs).toEqual([
      expect.objectContaining({
        id: "search-tab",
        needsAttention: true,
      }),
    ]);
    expect(result.current.activeTabId).toBe("main");
    expect(invokeMock).not.toHaveBeenCalledWith("switch_tab", {
      id: "search-tab",
    });

    act(() => {
      emitBrowserTabVerificationCleared({ id: "search-tab" });
    });

    expect(result.current.tabs[0]?.needsAttention).toBe(false);
    expect(result.current.activeTabId).toBe("main");
  });

  it("ignores verification events for unknown tabs", () => {
    const { result } = renderHook(() => useBrowserTabs());

    act(() => {
      emitBrowserTabVerificationRequired({ id: "missing-tab" });
    });

    expect(result.current.tabs).toEqual([]);
  });

  it("routes stale notification tab IDs back to the main surface", () => {
    const { result } = renderHook(() => useBrowserTabs());

    act(() => {
      result.current.switchToTab("already-closed-tab");
    });

    expect(result.current.activeTabId).toBe("main");
    expect(invokeMock).toHaveBeenCalledWith("switch_tab", { id: "main" });
  });
});
