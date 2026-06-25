import { describe, expect, test } from "vitest";
import { runEuropeanWaterfall } from "@/lib/engine";

describe("European LP/GP waterfall", () => {
  test("disabled waterfall leaves the complete deal return with the LP", () => {
    const flows = [
      { t: 0, amount: -100 },
      { t: 1, amount: 10 },
      { t: 2, amount: 120 },
    ];
    const result = runEuropeanWaterfall(flows, null);
    expect(result.enabled).toBe(false);
    expect(result.lpCashFlows).toEqual(flows);
    expect(result.gpCashFlows).toEqual([]);
    expect(result.lpEquityMultiple).toBeCloseTo(1.3, 8);
    expect(result.gpPromote).toBe(0);
  });

  test("8% pref and 80/20 promote allocate a hand-computed terminal distribution", () => {
    const result = runEuropeanWaterfall(
      [
        { t: 0, amount: -100 },
        { t: 1, amount: 140 },
      ],
      {
        lpEquityPct: 90,
        preferredReturnPct: 8,
        gpCatchUp: false,
        promoteTiers: [{ hurdleRatePct: 8, gpSplitPct: 20 }],
      },
    );

    // Capital: LP 90, GP 10. LP pref: 7.2. Residual 32.8 at 80/20:
    // LP 26.24, GP 6.56. Total distributions: LP 123.44, GP 16.56.
    expect(result.lpCashFlows).toEqual([
      { t: 0, amount: -90 },
      { t: 1, amount: 123.44 },
    ]);
    expect(result.gpCashFlows).toEqual([
      { t: 0, amount: -10 },
      { t: 1, amount: 16.56 },
    ]);
    expect(result.lpIrrPct).toBeCloseTo(37.1555556, 5);
    expect(result.gpIrrPct).toBeCloseTo(65.6, 5);
    expect(result.lpEquityMultiple).toBeCloseTo(123.44 / 90, 8);
    expect(result.gpEquityMultiple).toBeCloseTo(1.656, 8);
    // Base GP profit at its 10% capital share is 4.0. Actual GP profit is 6.56.
    expect(result.gpPromote).toBeCloseTo(2.56, 8);
  });

  test("a second promote tier increases GP return after the LP clears its hurdle", () => {
    const singleTier = runEuropeanWaterfall(
      [
        { t: 0, amount: -100 },
        { t: 5, amount: 250 },
      ],
      {
        lpEquityPct: 90,
        preferredReturnPct: 8,
        gpCatchUp: true,
        promoteTiers: [{ hurdleRatePct: 8, gpSplitPct: 20 }],
      },
    );
    const twoTier = runEuropeanWaterfall(
      [
        { t: 0, amount: -100 },
        { t: 5, amount: 250 },
      ],
      {
        lpEquityPct: 90,
        preferredReturnPct: 8,
        gpCatchUp: true,
        promoteTiers: [
          { hurdleRatePct: 8, gpSplitPct: 20 },
          { hurdleRatePct: 15, gpSplitPct: 30 },
        ],
      },
    );
    expect(twoTier.gpPromote).toBeGreaterThan(singleTier.gpPromote);
    expect(twoTier.gpIrrPct).toBeGreaterThan(singleTier.gpIrrPct);
    expect(twoTier.lpIrrPct).toBeLessThan(singleTier.lpIrrPct);
  });
});
