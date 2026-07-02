// Regression pins for the 2026-07 line-by-line engine audit. Every test here
// captures a bug that shipped (or a convention that was undocumented) so it
// cannot silently regress: refinance edge cases, the provenance-gate unit
// hole, decimal rounding symmetry, sensitivity degeneracy, stress coverage,
// input-assembly fail-closed gaps, and the waterfall's hurdle conventions.

import { describe, expect, test } from "vitest";
import {
  STRESS_PRESETS,
  applyStress,
  collectNumericTokens,
  computeReadiness,
  roundMoney,
  runUnderwriting,
  runWaterfall,
  tornado,
  verifyNumericProvenance,
  type ProjectInputRows,
  type UnderwritingInput,
} from "@/lib/engine";
import { loanBalanceAfterMonths } from "@/lib/engine/debt";

function devDeal(overrides: Partial<UnderwritingInput> = {}): UnderwritingInput {
  return {
    budget: { land: 5_000_000, hard: 20_000_000, soft: 3_000_000, contingency: 0 },
    revenueProgram: [
      { unitType: "Residential", unitCount: 100, rent: 3_000, rentBasis: "per_unit" },
    ],
    constructionMonths: 12,
    leaseUpMonths: 12,
    stabilizedOccupancyPct: 95,
    expenseRatioPct: 35,
    otherIncomeAnnual: 0,
    exitCapRatePct: 5,
    loanAmount: 18_000_000,
    interestRatePct: 6,
    amortYears: 30,
    ioMonths: 24,
    avgOutstandingFactor: 0.5,
    sellingCostsPct: 2,
    holdYears: 5,
    equityAmount: 10_000_000,
    rentGrowthPct: 3,
    expenseGrowthPct: 2,
    ...overrides,
  };
}

describe("refinance edge cases (schedule spine)", () => {
  test("a refinance dated past the exit is ignored with a warning, not silently modeled", () => {
    const out = runUnderwriting(
      devDeal({
        constructionMonths: 0,
        leaseUpMonths: 0,
        ioMonths: 120,
        holdYears: 5, // 60-month horizon
        monthlyModel: true,
        refinance: { month: 100, newAmount: 22_000_000, ratePct: 5, amortYears: 30, ioMonths: 0 },
      }),
    );
    expect(out.warnings.some((w) => w.key === "refinance_beyond_horizon")).toBe(true);
    // No refi metrics, and the exit payoff is the ORIGINAL loan (18M IO), not
    // the phantom 22M loan.
    expect(out.values.refiNewLoanAmount).toBeUndefined();
    const payoffNode = out.schedule!.nodes.find((n) => n.lineKey === "loan_payoff");
    expect(payoffNode).toBeDefined();
    expect(payoffNode!.amount).toBeCloseTo(-18_000_000, 2);
    // And no node may sit outside the schedule horizon.
    expect(out.schedule!.nodes.every((n) => n.period < out.schedule!.months)).toBe(true);
  });

  test("a lease-up refinance warns and keeps the payoff clock on the refi month", () => {
    const refiMonth = 18; // inside lease-up (C=12, L=12)
    const out = runUnderwriting(
      devDeal({
        monthlyModel: true,
        refinance: {
          month: refiMonth,
          newAmount: 20_000_000,
          ratePct: 5,
          amortYears: 30,
          ioMonths: 0,
        },
      }),
    );
    expect(out.warnings.some((w) => w.key === "refinance_before_stabilization")).toBe(true);
    const totalMonths = out.schedule!.months; // 12 + 12 + 60 = 84
    expect(totalMonths).toBe(84);
    // The new loan amortizes from the refi month to exit (66 months), not from
    // stabilization (which would credit it with zero elapsed time).
    const expectedPayoff = loanBalanceAfterMonths(20_000_000, 5, 30, 0, totalMonths - refiMonth);
    const payoffNode = out.schedule!.nodes.find((n) => n.lineKey === "loan_payoff");
    expect(payoffNode!.amount).toBeCloseTo(-expectedPayoff, 2);
  });

  test("a cash-out refi whose payoff exceeds the sale hits the non-recourse floor", () => {
    const out = runUnderwriting(
      devDeal({
        constructionMonths: 0,
        leaseUpMonths: 0,
        ioMonths: 120,
        holdYears: 3,
        monthlyModel: true,
        // 100% LTV cash-out at month 12: new loan = full value, so the exit
        // payoff exceeds net sale proceeds (sale nets 98% of value).
        refinance: {
          month: 12,
          newAmount: null,
          ltvPct: 100,
          ratePct: 6,
          amortYears: 0,
          ioMonths: 120,
        },
      }),
    );
    expect(out.warnings.some((w) => w.key === "refi_exit_shortfall")).toBe(true);
    // Equity never writes a cheque at the sale: the sale/payoff nodes are
    // suppressed and the monthly IRR is not meaningful.
    expect(out.schedule!.nodes.some((n) => n.lineKey === "sale")).toBe(false);
    expect(out.schedule!.nodes.some((n) => n.lineKey === "loan_payoff")).toBe(false);
    expect(Number.isNaN(out.values.scheduleLeveredIrrPct)).toBe(true);
  });
});

describe("monthly spine windows and clamps", () => {
  test("a window-less custom line covers lease-up months (every operating period)", () => {
    const out = runUnderwriting(
      devDeal({
        monthlyModel: true,
        leaseUpCurve: true,
        customLines: [{ key: "mgmt", label: "Mgmt fee", expression: "noi * 0.03" }],
      }),
    );
    const customPeriods = out
      .schedule!.nodes.filter((n) => n.key === "custom_mgmt")
      .map((n) => n.period);
    // C=12, L=12: lease-up operating months are 12..23 and must be covered.
    expect(customPeriods.some((p) => p >= 12 && p < 24)).toBe(true);
    expect(customPeriods.some((p) => p >= 24)).toBe(true);
    expect(customPeriods.every((p) => p >= 12)).toBe(true);
  });

  test("an equity draw schedule longer than the horizon is clamped with a warning", () => {
    const out = runUnderwriting(
      devDeal({ holdYears: 1, monthlyModel: true, equityDrawMonths: 60 }),
    );
    expect(out.warnings.some((w) => w.key === "equity_draw_beyond_horizon")).toBe(true);
    const equityPeriods = out
      .schedule!.nodes.filter((n) => n.lineKey === "equity_contribution")
      .map((n) => n.period);
    // Horizon is 24 + 12 = 36 months: no contribution may be dated after exit.
    expect(Math.max(...equityPeriods)).toBeLessThan(36);
  });

  test("monthly-only features that cannot take effect raise a warning instead of vanishing", () => {
    const out = runUnderwriting(
      devDeal({
        refinance: { month: 30, newAmount: 20_000_000, ratePct: 5, amortYears: 30, ioMonths: 0 },
        // monthlyModel deliberately off
      }),
    );
    expect(out.warnings.some((w) => w.key === "monthly_features_inactive")).toBe(true);
    // The annual output is otherwise unchanged (no refi metrics).
    expect(out.values.refiNewLoanAmount).toBeUndefined();
  });
});

describe("provenance gate: unit-suffixed tokens are never implicitly allowed", () => {
  test("$-prefixed and unit-suffixed small/year-range numbers are checked, bare ordinals are not", () => {
    const fabricated = "Rent $1,999 and $2,050; exit cap 7%; multiple 5x; spread 10 bps";
    const report = verifyNumericProvenance(fabricated, []);
    expect(report.pass).toBe(false);
    expect(report.orphans.length).toBe(5);
    // Bare counts and calendar years remain implicitly allowed.
    expect(verifyNumericProvenance("Phase 2 completes in 2027 over 12 months", []).pass).toBe(true);
  });

  test("a spaced 'x' is multiplication in formula text, not a multiple unit", () => {
    const tokens = collectNumericTokens("EGI = Residential 8,052,000 x 96%");
    const big = tokens.find((t) => t.value === 8_052_000);
    expect(big).toBeDefined();
    expect(big!.unit).toBeUndefined();
    expect(tokens.some((t) => t.value === 96 && t.unit === "%")).toBe(true);
    // Adjacent x is still a multiple.
    expect(collectNumericTokens("equity multiple 1.85x")[0]).toMatchObject({
      value: 1.85,
      unit: "x",
    });
  });
});

describe("decimal money: half-cent rounding is exact and sign-symmetric", () => {
  test("roundMoney handles float-representation half cents and negatives", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(10.005)).toBe(10.01);
  });
});

describe("sensitivity + stress coverage", () => {
  test("a zero-base driver (0% rent growth) still produces a real tornado swing", () => {
    const bars = tornado(devDeal({ rentGrowthPct: 0 }), ["rent_growth"], 10, "irr");
    expect(bars[0].low).toBeLessThan(bars[0].high);
    expect(bars[0].swing).toBeGreaterThan(0);
  });

  test("a negative-base driver keeps low < high", () => {
    const bars = tornado(devDeal({ rentGrowthPct: -2 }), ["rent_growth"], 10, "irr");
    expect(bars[0].low).toBeLessThan(bars[0].high);
  });

  test("a rate shock reprices the mezzanine and refinance coupons too", () => {
    const preset = STRESS_PRESETS.find((p) => p.key === "rate_shock")!;
    const stressed = applyStress(
      devDeal({
        mezzanine: { amount: 5_000_000, ratePct: 11, amortYears: 0, ioMonths: 0 },
        refinance: { month: 30, newAmount: 20_000_000, ratePct: 5, amortYears: 30, ioMonths: 0 },
      }),
      preset,
    );
    expect(stressed.interestRatePct).toBeCloseTo(7.5, 10);
    expect(stressed.mezzanine!.ratePct).toBeCloseTo(12.5, 10);
    expect(stressed.refinance!.ratePct).toBeCloseTo(6.5, 10);
  });
});

describe("input assembly: fail-closed completeness", () => {
  test("a per-SF rent without square footage blocks readiness instead of feeding $0 GPR", () => {
    const rows: ProjectInputRows = {
      scalars: [],
      budget: [],
      revenue: [
        {
          unit_type: "retail",
          unit_count: 1,
          avg_sf: null,
          rent: 42,
          rent_basis: "per_sf",
          status: "approved",
        },
      ],
    };
    const readiness = computeReadiness(rows);
    expect(readiness.status).toBe("blocked");
    expect(readiness.missing).toContain("sf:retail");
    // The incomplete component does not count as a usable revenue program.
    expect(readiness.missing).toContain("revenue_program");
  });
});

describe("waterfall conventions (hand-computed pins)", () => {
  test("finite hurdles are whole-equity (deal-level) IRR hurdles", () => {
    // LP 100 / GP 0, no pref, 80/20 to a 10% deal IRR, then 50/50.
    // -1,000,000 at t=0; +2,000,000 at t=5. 1,000,000 x 1.1^5 = 1,610,510.
    // Band 1 (return of capital, pari-passu): 1,000,000 to LP.
    // Band 2 (to the 10% deal hurdle): 610,510 split 80/20 = 488,408 / 122,102.
    // Open band: 389,490 split 50/50 = 194,745 / 194,745.
    const res = runWaterfall(
      [
        { t: 0, amount: -1_000_000 },
        { t: 5, amount: 2_000_000 },
      ],
      {
        lpEquityPct: 100,
        gpEquityPct: 0,
        preferredReturnPct: 0,
        gpCatchUpPct: 0,
        tiers: [
          { hurdlePct: 10, gpPct: 20 },
          { hurdlePct: null, gpPct: 50 },
        ],
      },
    );
    expect(res.lp.distributed).toBeCloseTo(1_683_153, 0);
    expect(res.gp.distributed).toBeCloseTo(316_847, 0);
  });

  test("partial catch-up targets the first tier's share of LP preferred and stretches the band", () => {
    // LP 100 / GP 0, 8% pref, 50% catch-up, 80/20 carry.
    // -1,000,000 at t=0; +3,000,000 at t=5. Pref balance: 1,469,328.08.
    // Catch-up target = (0.2/0.8) x 469,328.08 = 117,332.02 over a 234,664.04
    // band at 50/50; residual 1,296,007.88 splits 80/20.
    const res = runWaterfall(
      [
        { t: 0, amount: -1_000_000 },
        { t: 5, amount: 3_000_000 },
      ],
      {
        lpEquityPct: 100,
        gpEquityPct: 0,
        preferredReturnPct: 8,
        gpCatchUpPct: 50,
        tiers: [{ hurdlePct: null, gpPct: 20 }],
      },
    );
    expect(res.lpPreferredPaid).toBeCloseTo(469_328.08, 1);
    expect(res.gp.distributed).toBeCloseTo(117_332.02 + 259_201.58, 1);
    expect(res.lp.distributed + res.gp.distributed).toBeCloseTo(3_000_000, 2);
  });
});
