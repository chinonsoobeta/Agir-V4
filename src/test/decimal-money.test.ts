import { describe, expect, test } from "vitest";
import {
  annualDebtService,
  fromCents,
  interestOnlyDebtService,
  roundMoney,
  splitMoney,
  toCents,
} from "@/lib/engine";
import { runWaterfall, type WaterfallConfig } from "@/lib/engine";

describe("decimal money helpers", () => {
  test("rounds and splits money in exact cents", () => {
    expect(toCents(10.005)).toBe(1001);
    expect(fromCents(1001)).toBe(10.01);
    expect(roundMoney(123.456)).toBe(123.46);
    expect(splitMoney(100, [1 / 3, 1 / 3, 1 / 3])).toEqual([33.34, 33.33, 33.33]);
  });

  test("debt service returns cent-rounded annual dollars", () => {
    expect(annualDebtService(1_000_000, 6, 30)).toBe(71_946.12);
    expect(interestOnlyDebtService(1_000_000, 6.125)).toBe(61_250);
  });

  test("waterfall distributions reconcile to cents", () => {
    const cfg: WaterfallConfig = {
      lpEquityPct: 90,
      gpEquityPct: 10,
      preferredReturnPct: 8,
      gpCatchUpPct: 100,
      tiers: [{ hurdlePct: null, gpPct: 20 }],
    };
    const result = runWaterfall(
      [
        { t: 0, amount: -1_000_000 },
        { t: 5, amount: 2_000_000 },
      ],
      cfg,
    );

    expect(roundMoney(result.lp.distributed + result.gp.distributed)).toBe(2_000_000);
    expect(
      result.lp.flows.every((flow) => toCents(flow.amount) === Math.round(flow.amount * 100)),
    ).toBe(true);
  });
});
