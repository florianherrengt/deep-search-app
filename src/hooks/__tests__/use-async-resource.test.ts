// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncResource } from "@/hooks/use-async-resource";

function flushPromises() {
  return act(() => Promise.resolve());
}

describe("useAsyncResource", () => {
  it("sets error and clears loading when load() rejects", async () => {
    const load = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const { result } = renderHook(() =>
      useAsyncResource("initial", load, []),
    );

    await flushPromises();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toEqual(new Error("fetch failed"));
    expect(result.current.data).toBe("initial");
  });

  it("sets data and clears error when load() succeeds", async () => {
    const load = vi.fn().mockResolvedValue("loaded data");

    const { result } = renderHook(() =>
      useAsyncResource("initial", load, []),
    );

    await flushPromises();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("loaded data");
  });

  it("refresh sets error on failure and clears error on success", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce("loaded data")
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce("refreshed data");

    const { result } = renderHook(() =>
      useAsyncResource("initial", load, []),
    );

    await flushPromises();

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("loaded data");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toEqual(new Error("refresh failed"));
    expect(result.current.data).toBe("loaded data");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("refreshed data");
  });

  it("does not update state when effect is cancelled before load completes", async () => {
    let resolveLoad: (value: string) => void;
    const load = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { result, unmount } = renderHook(() =>
      useAsyncResource("initial", load, []),
    );

    unmount();

    await act(async () => {
      resolveLoad("stale data");
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe("initial");
    expect(result.current.error).toBeNull();
  });
});
