import { describe, it } from "vitest";
import { detectForeignCurrencyMentions } from "@/lib/agent-guards";

/**
 * Focused perf measurement for the currency-detection guard. Runs only when
 * BENCH_GUARD_CURRENCY=1 so it never affects the normal unit-test suite.
 *
 * Measures the cost of detectForeignCurrencyMentions on a realistic assistant
 * answer that contains foreign currency mentions (the path that forces the most
 * regex work: every non-target symbol pattern is built and scanned).
 */
describe("detectForeignCurrencyMentions perf", { concurrent: false }, () => {
  it("measures throughput", () => {
    if (process.env.BENCH_GUARD_CURRENCY !== "1") return;

    const text = [
      "The laptop costs $1,299 in the US and about £999 in the UK.",
      "European pricing is set at €1,499 incl. VAT.",
      "Japanese units retail for ¥199,000, while Australian stock is A$2,199.",
      "For reference, a comparable model is ₹1,10,000 in India and ₩2,490,000 in Korea.",
      "Shipping is CA$40 within Canada. Total budget around US$1,500.",
      "Some resellers quote 500 CHF and others around 600 EUR depending on exchange.",
    ].join("\n");

    const ITERATIONS = 2000;
    const WARMUP = 50;

    for (let i = 0; i < WARMUP; i += 1) {
      detectForeignCurrencyMentions(text, "USD");
    }

    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      detectForeignCurrencyMentions(text, "USD");
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const total = samples.reduce((sum, v) => sum + v, 0);
    const mean = total / ITERATIONS;
    const p50 = samples[Math.floor(ITERATIONS * 0.5)];
    const p99 = samples[Math.floor(ITERATIONS * 0.99)];

    const result = {
      iterations: ITERATIONS,
      meanMs: Number(mean.toFixed(4)),
      p50Ms: Number(p50.toFixed(4)),
      p99Ms: Number(p99.toFixed(4)),
      totalMs: Number(total.toFixed(2)),
      detected: detectForeignCurrencyMentions(text, "USD").length,
    };

    console.log("[bench:guard-currency]", JSON.stringify(result));
  });
});
