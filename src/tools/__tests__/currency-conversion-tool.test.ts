import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodSchema } from "ai";

const bridgeMocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  fetch: bridgeMocks.mockFetch,
}));

import { createCurrencyConversionTool, currencyConversionInputSchema } from "@/tools/currency-conversion-tool";

describe("currencyConversionInputSchema JSON Schema shape", () => {
  it("produces root type 'object', not 'array' (AI SDK tool contract)", () => {
    const schema = zodSchema(currencyConversionInputSchema);
    const jsonSchema = schema.jsonSchema as Record<string, unknown>;
    expect(jsonSchema.type).toBe("object");
  });

  it("produces a valid JSON Schema with properties", () => {
    const schema = zodSchema(currencyConversionInputSchema);
    const jsonSchema = schema.jsonSchema as Record<string, unknown>;
    const props = jsonSchema.properties as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    expect(props?.conversions).toBeDefined();
    const conversions = props?.conversions as Record<string, unknown>;
    expect(conversions.type).toBe("array");
  });
});

describe("currencyConversionInputSchema validation", () => {
  it("accepts object with conversions array", () => {
    const result = currencyConversionInputSchema.safeParse({
      conversions: [{ amount: 100, from_currency: "EUR" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple conversion items", () => {
    const result = currencyConversionInputSchema.safeParse({
      conversions: [
        { amount: 100, from_currency: "EUR" },
        { amount: 50, from_currency: "GBP" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects direct array (old shape)", () => {
    const result = currencyConversionInputSchema.safeParse([
      { amount: 100, from_currency: "EUR" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects missing conversions key", () => {
    const result = currencyConversionInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects negative amounts", () => {
    const result = currencyConversionInputSchema.safeParse({
      conversions: [{ amount: -50, from_currency: "EUR" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero amounts", () => {
    const result = currencyConversionInputSchema.safeParse({
      conversions: [{ amount: 0, from_currency: "EUR" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing from_currency", () => {
    const result = currencyConversionInputSchema.safeParse({
      conversions: [{ amount: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createCurrencyConversionTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates tool with USD as target currency", () => {
    const t = createCurrencyConversionTool("USD");
    expect(t.description).toContain("USD");
  });

  it("creates tool with EUR as target currency", () => {
    const t = createCurrencyConversionTool("EUR");
    expect(t.description).toContain("EUR");
  });

  it("has strict mode enabled", () => {
    const t = createCurrencyConversionTool("USD");
    expect(t.strict).toBe(true);
  });

  it("has inputSchema with object type", () => {
    const t = createCurrencyConversionTool("USD");
    const inputSchema = t.inputSchema as { jsonSchema: Record<string, unknown> };
    expect(inputSchema.jsonSchema.type).toBe("object");
  });

  it("executes and converts EUR to USD via API", async () => {
    bridgeMocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ date: "2026-06-18", base: "EUR", quote: "USD", rate: 1.1 }),
    });

    const t = createCurrencyConversionTool("USD");
    const result = await t.execute!(
      { conversions: [{ amount: 100, from_currency: "EUR" }] },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toEqual(["110.00"]);
    expect(bridgeMocks.mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/rate/EUR/USD"),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("handles same-currency conversion without API call", async () => {
    const t = createCurrencyConversionTool("USD");
    const result = await t.execute!(
      { conversions: [{ amount: 100, from_currency: "USD" }] },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toEqual(["100.00"]);
    expect(bridgeMocks.mockFetch).not.toHaveBeenCalled();
  });

  it("converts multiple currencies in parallel", async () => {
    bridgeMocks.mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ date: "2026-06-18", base: "GBP", quote: "USD", rate: 1.3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ date: "2026-06-18", base: "JPY", quote: "USD", rate: 0.007 }),
      });

    const t = createCurrencyConversionTool("USD");
    const result = await t.execute!(
      {
        conversions: [
          { amount: 50, from_currency: "GBP" },
          { amount: 1000, from_currency: "JPY" },
        ],
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toEqual(["65.00", "7.00"]);
  });

  it("caches rates and reuses them on subsequent calls", async () => {
    bridgeMocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ date: "2026-06-18", base: "CAD", quote: "USD", rate: 0.75 }),
    });

    const t = createCurrencyConversionTool("USD");

    await t.execute!(
      { conversions: [{ amount: 100, from_currency: "cad" }] },
      { toolCallId: "call-1", messages: [] },
    );

    const result = await t.execute!(
      { conversions: [{ amount: 200, from_currency: "CAD" }] },
      { toolCallId: "call-2", messages: [] },
    );

    expect(result).toEqual(["150.00"]);
    expect(bridgeMocks.mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on API error", async () => {
    bridgeMocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const t = createCurrencyConversionTool("USD");
    await expect(
      t.execute!(
        { conversions: [{ amount: 100, from_currency: "CHF" }] },
        { toolCallId: "call-1", messages: [] },
      ),
    ).rejects.toThrow("Currency API error: 500 Internal Server Error");
  });

  it("throws on invalid API response shape", async () => {
    bridgeMocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invalid: true }),
    });

    const t = createCurrencyConversionTool("USD");
    await expect(
      t.execute!(
        { conversions: [{ amount: 100, from_currency: "AUD" }] },
        { toolCallId: "call-1", messages: [] },
      ),
    ).rejects.toThrow("Invalid response from currency API");
  });

  it("passes abort signal to fetch", async () => {
    bridgeMocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ date: "2026-06-18", base: "NZD", quote: "USD", rate: 0.62 }),
    });

    const abortController = new AbortController();
    const t = createCurrencyConversionTool("USD");
    await t.execute!(
      { conversions: [{ amount: 100, from_currency: "NZD" }] },
      {
        toolCallId: "call-1",
        messages: [],
        abortSignal: abortController.signal,
      },
    );

    expect(bridgeMocks.mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: abortController.signal }),
    );
  });
});
