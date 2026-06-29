// Tier 3 hardening: a performance budget gate so the engine stays consistently
// fast as the codebase grows. Thresholds are deliberately GENEROUS (roughly
// 6-12x the observed local cost) so they survive a slow/shared CI runner yet
// still fail on an order-of-magnitude regression (e.g. an accidental O(n^2) or a
// per-run allocation blowup). Extraction throughput is gated separately in
// extraction-scale.test.ts.

import { describe, expect, test } from "vitest";
import { mapleHeightsInput, runUnderwriting, type UnderwritingInput } from "@/lib/engine";

const annual = mapleHeightsInput() as UnderwritingInput;

// The heaviest path: the monthly spine with every precision feature engaged.
const monthlyFull: UnderwritingInput = {
  ...annual,
  monthlyModel: true,
  holdYears: 7,
  constructionDrawCurve: "s_curve",
  leaseUpCurve: true,
  equityDrawMonths: 12,
  mezzanine: { amount: 3_000_000, ratePct: 11, amortYears: 30, ioMonths: 24 },
  refinance: { month: 36, ltvPct: 65, ratePct: 5.5, amortYears: 30, ioMonths: 0 },
};

describe("engine performance budget", () => {
  test("500 annual underwriting runs complete well under budget", () => {
    const started = performance.now();
    for (let i = 0; i < 500; i++) runUnderwriting(annual);
    const elapsed = performance.now() - started;
    console.info(
      `[perf] 500 annual runs in ${elapsed.toFixed(0)}ms (${(elapsed / 500).toFixed(2)}ms/run)`,
    );
    expect(elapsed).toBeLessThan(5_000);
  });

  test("50 full monthly-spine runs (all precision features) complete under budget", () => {
    // Warm up so JIT compilation does not skew the first measurement.
    for (let i = 0; i < 5; i++) runUnderwriting(monthlyFull);
    const started = performance.now();
    for (let i = 0; i < 50; i++) runUnderwriting(monthlyFull);
    const elapsed = performance.now() - started;
    console.info(
      `[perf] 50 monthly-full runs in ${elapsed.toFixed(0)}ms (${(elapsed / 50).toFixed(2)}ms/run)`,
    );
    expect(elapsed).toBeLessThan(5_000);
  });
});
