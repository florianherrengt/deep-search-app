import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Settings schema has 27 keys; using that count keeps the benchmark aligned
// with the real hot path (settingsStore.get()).
const KEYS = [
  "chat_provider",
  "openrouter_api_key",
  "anthropic_api_key",
  "deepseek_api_key",
  "zhipu_api_key",
  "zhipu_base_url",
  "opencode_zen_api_key",
  "local_api_key",
  "local_base_url",
  "local_model",
  "searxng_url",
  "brave_api_key",
  "exa_api_key",
  "serper_api_key",
  "tavily_api_key",
  "scrape_do_api_key",
  "default_model",
  "anthropic_model",
  "deepseek_model",
  "zhipu_model",
  "opencode_zen_model",
  "currency",
  "chrome_devtools_mcp_enabled",
  "chrome_devtools_mcp_connection_mode",
  "chrome_devtools_mcp_browser_url",
  "chrome_devtools_mcp_node_path",
  "web_extraction_backend",
];

const DEFAULTS = Object.fromEntries(KEYS.map((k) => [k, ""]));

function makeMockStore() {
  const data: Record<string, unknown> = { ...DEFAULTS };
  let gets = 0;
  let entriesCalls = 0;
  return {
    data,
    counts: {
      get gets() {
        return gets;
      },
      get entries() {
        return entriesCalls;
      },
      reset() {
        gets = 0;
        entriesCalls = 0;
      },
    },
    store: {
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
        Object.keys(data).forEach((k) => delete data[k]);
      }),
    },
  };
}

describe("settingsStore.get() IPC cost", { concurrent: false }, () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads all 27 keys with one entries() call", async () => {
    if (process.env.BENCH_STORE_IPC !== "1") return;

    const { z } = await import("zod");
    const mock = makeMockStore();
    vi.doMock("@/lib/tauri-bridge", () => ({
      loadStore: vi.fn(async () => mock.store),
    }));

    const { createStore } = await import("@/lib/store");
    const schema = z.object(
      Object.fromEntries(KEYS.map((k) => [k, z.string()])),
    );
    const store = createStore("bench.json", schema, DEFAULTS as any);

    const ITERATIONS = 200;
    const WARMUP = 20;
    for (let i = 0; i < WARMUP; i += 1) {
      await store.get();
    }
    mock.counts.reset();

    const latency: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const t = performance.now();
      await store.get();
      latency.push(performance.now() - t);
    }

    const mean = (xs: number[]) =>
      xs.reduce((a, b) => a + b, 0) / xs.length;

    const result = {
      keysCount: KEYS.length,
      iterations: ITERATIONS,
      ipcCallsPerGet: mock.counts.entries / ITERATIONS,
      perKeyGetsPerGet: mock.counts.gets / ITERATIONS,
      meanMs: Number(mean(latency).toFixed(4)),
    };

    // eslint-disable-next-line no-console
    console.log("\nSTORE_IPC_BENCH_RESULT", JSON.stringify(result));

    // Before optimization: 27 IPC round-trips per get(). After: 1.
    expect(result.ipcCallsPerGet).toBe(1);
    expect(result.perKeyGetsPerGet).toBe(0);
  });
});
