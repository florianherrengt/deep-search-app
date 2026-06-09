import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import type { Currency } from "@/lib/settings-store";

declare global {
  interface Window {
    __deepSearchCurrencyMock?: (from: string, to: string, amount: number) => Promise<string>;
  }
}

function getDevCurrencyMock(): ((from: string, to: string, amount: number) => Promise<string>) | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return window.__deepSearchCurrencyMock ?? null;
}

const API_BASE = "https://api.frankfurter.dev/v2";

type RateKey = `${string}_${string}`;

const ratesCache = new Map<RateKey, { rate: number; date: string }>();

function cacheKey(base: string, quote: string): RateKey {
  return `${base.toUpperCase()}_${quote.toUpperCase()}`;
}

const RateResponseSchema = z.object({
  date: z.string(),
  base: z.string(),
  quote: z.string(),
  rate: z.number(),
});

const currencyConversionInputSchema = z.object({
  amount: z.number().positive().describe("The amount of money to convert"),
  from_currency: z
    .string()
    .describe("Currency code of the amount (e.g. USD, EUR, GBP)"),
});

const currencyConversionOutputSchema = z.string();

export function createCurrencyConversionTool(targetCurrency: Currency) {
  return tool({
    description: `Convert a foreign price, cost, fee, or other monetary amount to ${targetCurrency}. Use before final answers that would otherwise show a foreign currency; report only ${targetCurrency} unless the user asks for original currencies.`,
    strict: true,
    inputSchema: zodSchema(currencyConversionInputSchema),
    outputSchema: zodSchema(currencyConversionOutputSchema),
    execute: async ({ amount, from_currency }, options) => {
      const from = from_currency.toUpperCase();
      const to = targetCurrency;

      if (from === to) {
        return amount.toFixed(2);
      }

      const mock = getDevCurrencyMock();
      if (mock) return mock(from, to, amount);

      const key = cacheKey(from, to);

      let cached = ratesCache.get(key);
      if (!cached) {
        const response = await fetch(
          `${API_BASE}/rate/${from}/${to}`,
          {
            headers: { accept: "application/json" },
            signal: options?.abortSignal,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Currency API error: ${response.status} ${response.statusText}`,
          );
        }

        const parsed = RateResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error("Invalid response from currency API");
        }

        cached = {
          rate: parsed.data.rate,
          date: parsed.data.date,
        };
        ratesCache.set(key, cached);
      }

      return (amount * cached.rate).toFixed(2);
    },
  });
}
