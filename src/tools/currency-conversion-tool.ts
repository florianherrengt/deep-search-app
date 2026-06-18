import { tool, zodSchema } from "ai";
import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import type { Currency } from "@/lib/settings-store";

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

const ConversionItemSchema = z.object({
  amount: z.number().positive().describe("The amount of money to convert"),
  from_currency: z
    .string()
    .describe("Currency code of the amount (e.g. USD, EUR, GBP)"),
});

export const currencyConversionInputSchema = z.object({
  conversions: z.array(ConversionItemSchema).describe("List of conversions to perform"),
});

const currencyConversionOutputSchema = z.array(z.string());

export function createCurrencyConversionTool(targetCurrency: Currency) {
  return tool({
    description: `Convert foreign prices, costs, fees, or other monetary amounts to ${targetCurrency}. Accepts an array of { amount, from_currency } objects. Use before final answers that would otherwise show a foreign currency; report only ${targetCurrency} unless the user asks for original currencies.`,
    strict: true,
    inputSchema: zodSchema(currencyConversionInputSchema),
    outputSchema: zodSchema(currencyConversionOutputSchema),
    execute: async (input, options) => {
      const convertOne = async (item: { amount: number; from_currency: string }) => {
        const from = item.from_currency.toUpperCase();
        const to = targetCurrency;

        if (from === to) {
          return item.amount.toFixed(2);
        }

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

        return (item.amount * cached.rate).toFixed(2);
      };

      return Promise.all(input.conversions.map(convertOne));
    },
  });
}
