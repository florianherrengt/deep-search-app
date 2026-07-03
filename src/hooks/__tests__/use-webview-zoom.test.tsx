// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const setZoom = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  isTauri: () => true,
}));

import { useWebviewZoom } from "@/hooks/use-webview-zoom";

function flushPromises() {
  return act(() => Promise.resolve());
}

describe("useWebviewZoom", () => {
  beforeEach(() => {
    setZoom.mockClear();
  });

  it("applies persisted zoom once hydrated", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ level, hydrated }) =>
        useWebviewZoom(level, updateSetting, hydrated),
      { initialProps: { level: 1.5, hydrated: false } },
    );

    expect(setZoom).not.toHaveBeenCalled();

    rerender({ level: 1.5, hydrated: true });
    await flushPromises();

    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(1.5);
  });

  it("does not apply zoom before hydration", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useWebviewZoom(1.5, updateSetting, false));

    await flushPromises();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("zoomIn steps up by 0.1 and persists", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useWebviewZoom(1, updateSetting, true),
    );
    await flushPromises();

    setZoom.mockClear();
    act(() => result.current.zoomIn());
    await flushPromises();

    expect(setZoom).toHaveBeenCalledWith(1.1);
    expect(updateSetting).toHaveBeenCalledWith("zoom_level", 1.1);
  });

  it("zoomOut clamps at the minimum (0.5)", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useWebviewZoom(0.5, updateSetting, true),
    );
    await flushPromises();

    setZoom.mockClear();
    act(() => result.current.zoomOut());
    await flushPromises();

    expect(setZoom).toHaveBeenCalledWith(0.5);
    expect(updateSetting).toHaveBeenCalledWith("zoom_level", 0.5);
  });

  it("resetZoom restores 1", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useWebviewZoom(1.5, updateSetting, true),
    );
    await flushPromises();

    setZoom.mockClear();
    act(() => result.current.resetZoom());
    await flushPromises();

    expect(setZoom).toHaveBeenCalledWith(1);
    expect(updateSetting).toHaveBeenCalledWith("zoom_level", 1);
  });

  it("never zooms above the maximum (2.0)", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useWebviewZoom(2, updateSetting, true),
    );
    await flushPromises();

    setZoom.mockClear();
    act(() => result.current.zoomIn());
    await flushPromises();

    expect(setZoom).toHaveBeenCalledWith(2);
    expect(updateSetting).toHaveBeenCalledWith("zoom_level", 2);
  });

  it("keeps callback identities stable across re-renders", async () => {
    const updateSetting = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() =>
      useWebviewZoom(1, updateSetting, true),
    );
    await flushPromises();

    const { zoomIn, zoomOut, resetZoom } = result.current;
    rerender();
    expect(result.current.zoomIn).toBe(zoomIn);
    expect(result.current.zoomOut).toBe(zoomOut);
    expect(result.current.resetZoom).toBe(resetZoom);
  });
});
