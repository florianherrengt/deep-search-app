import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-bridge", () => {
  let data: Record<string, unknown> = {};
  let gets = 0;
  let entriesCalls = 0;
  let clears = 0;
  return {
    loadStore: vi.fn(async () => ({
      get: vi.fn(async (key: string) => {
        gets += 1;
        return key in data ? data[key] : null;
      }),
      set: vi.fn(async (key: string, value: unknown) => {
        data[key] = value;
      }),
      save: vi.fn(async () => {}),
      entries: vi.fn(async () => {
        entriesCalls += 1;
        return Object.entries(data);
      }),
      clear: vi.fn(async () => {
        clears += 1;
        data = {};
      }),
    })),
    // counters exposed for tests via the module export
    __counts: {
      get gets() {
        return gets;
      },
      get entries() {
        return entriesCalls;
      },
      get clears() {
        return clears;
      },
      resetCounters() {
        gets = 0;
        entriesCalls = 0;
        clears = 0;
      },
      resetData() {
        data = {};
      },
    },
  };
});

import { z } from "zod";
import { createStore } from "@/lib/store";
// The mock above replaces @/lib/tauri-bridge. We import the counters off the
// mocked module via the same path the SUT uses.
import * as tauriBridge from "@/lib/tauri-bridge";
const counters = (tauriBridge as unknown as {
  __counts: {
    gets: number;
    entries: number;
    clears: number;
    resetCounters: () => void;
    resetData: () => void;
  };
}).__counts;

const schema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.boolean(),
});
const defaults = { a: "default-a", b: "default-b", c: true };

describe("createStore.get() uses single entries() IPC call", () => {
  beforeEach(() => {
    counters.resetCounters();
    counters.resetData();
  });

  it("reads all keys with one entries() call instead of one get() per key", async () => {
    const store = createStore("test.json", schema, defaults);
    // Prime the underlying mock data with stored values via set().
    await store.set("a", "stored-a");
    await store.set("b", "stored-b");
    counters.resetCounters();

    const result = await store.get();

    expect(result).toEqual({ a: "stored-a", b: "stored-b", c: true });
    // The optimization: a single entries() call services all keys.
    expect(counters.entries).toBe(1);
    expect(counters.gets).toBe(0);
  });

  it("falls back to defaults for missing keys", async () => {
    const store = createStore("test-defaults.json", schema, defaults);
    const result = await store.get();
    expect(result).toEqual(defaults);
    expect(counters.entries).toBe(1);
  });

  it("falls back to defaults when stored value fails field schema", async () => {
    const store = createStore("test-invalid.json", schema, defaults);
    // Bypass schema validation by writing directly via the underlying store.
    const { loadStore } = tauriBridge;
    const inner = await loadStore("test-invalid.json", { autoSave: false, defaults: {} });
    await inner.set("c", "not-a-boolean");
    counters.resetCounters();

    const result = await store.get();
    expect(result.c).toBe(true);
  });
});

describe("createStore.reset() uses clear() then re-sets defaults", () => {
  beforeEach(() => {
    counters.resetCounters();
    counters.resetData();
  });

  it("clears the store once instead of deleting per-key", async () => {
    const store = createStore("reset.json", schema, defaults);
    await store.set("a", "modified");
    counters.resetCounters();

    await store.reset();

    expect(counters.clears).toBe(1);
    const result = await store.get();
    expect(result).toEqual(defaults);
  });
});
