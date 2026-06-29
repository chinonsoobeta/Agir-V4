// Tier 2 hardening: prove the safety nets actually catch what they must.
//
// (2a) the engine-input plausibility boundary flags scale slips / impossibilities
//      while leaving legitimately stressed deals alone, and
// (2b) every reconciliation check fires on a deal engineered to trip it and stays
//      silent on a clean one.

import { describe, expect, test } from "vitest";
import {
  mapleHeightsInput,
  runReconciliationChecks,
  runUnderwriting,
  validateEngineInput,
  type ReconciliationContext,
  type UnderwritingInput,
} from "@/lib/engine";

// ---------- 2a. Input plausibility boundary ----------

describe("engine-input plausibility boundary", () => {
  const sensible = mapleHeightsInput() as UnderwritingInput;

  test("a sensible deal produces no plausibility violations", () => {
    expect(validateEngineInput(sensible)).toEqual([]);
  });

  test("a stressed-but-legitimate deal (12% cap, 80% occ, 15% rate) is NOT flagged", () => {
    const stressed: UnderwritingInput = {
      ...sensible,
      exitCapRatePct: 12,
      stabilizedOccupancyPct: 80,
      interestRatePct: 15,
      expenseRatioPct: 70,
    };
    expect(validateEngineInput(stressed)).toEqual([]);
  });

  test.each([
    ["interestRatePct", { interestRatePct: 600 }],
    ["exitCapRatePct", { exitCapRatePct: 0 }],
    ["exitCapRatePct", { exitCapRatePct: 45 }],
    ["expenseRatioPct", { expenseRatioPct: 350 }],
    ["stabilizedOccupancyPct", { stabilizedOccupancyPct: 9400 }],
    ["loanAmount", { loanAmount: -1 }],
  ])("flags an implausible %s", (field, override) => {
    const violations = validateEngineInput({ ...sensible, ...override } as UnderwritingInput);
    expect(violations.some((v) => v.field === field)).toBe(true);
  });

  test("a negative budget line is flagged as a sign/scale slip", () => {
    const v = validateEngineInput({
      ...sensible,
      budget: { ...sensible.budget, hard: -28_000_000 },
    });
    expect(v.some((x) => x.field === "budget.hard")).toBe(true);
  });

  test("a zero/negative rent or unit count is flagged per component", () => {
    const v = validateEngineInput({
      ...sensible,
      revenueProgram: [{ unitType: "Residential", unitCount: 0, rent: 0, rentBasis: "per_unit" }],
    });
    expect(v.some((x) => x.field === "revenueProgram[0].rent")).toBe(true);
    expect(v.some((x) => x.field === "revenueProgram[0].unitCount")).toBe(true);
  });

  test("the violations surface as engine warnings, and a clean deal adds none", () => {
    const clean = runUnderwriting(sensible);
    expect(clean.warnings.some((w) => w.key.startsWith("input_plausibility:"))).toBe(false);

    const slipped = runUnderwriting({ ...sensible, interestRatePct: 600 });
    expect(slipped.warnings.some((w) => w.key === "input_plausibility:interestRatePct")).toBe(true);
  });
});

// ---------- 2b. Reconciliation efficacy ----------

// A balanced deal: sources fund TDC, DSCR/debt-yield/occupancy covenants pass,
// stated total matches the budget sum, unit counts agree. No flags expected.
function cleanContext(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
  return {
    tdc: 100_000_000,
    equity: 30_000_000,
    loan: 70_000_000,
    noi: 7_000_000,
    amortizingAnnualDebtService: 4_000_000,
    interestOnlyAnnualDebtService: 3_500_000,
    ioCoversHold: false,
    statedLtcPct: 70,
    minDscr: 1.25,
    minDebtYield: 8,
    debtYieldPct: 10,
    lenderStabilizedOccupancyPct: 90,
    componentOccupancies: [{ unitType: "Residential", occupancyPct: 95 }],
    statedTotalProjectCost: 100_000_000,
    budgetSum: 100_000_000,
    unitCounts: [200, 200],
    ...overrides,
  };
}

const errorKeys = (ctx: ReconciliationContext) =>
  runReconciliationChecks(ctx)
    .filter((f) => f.severity === "error")
    .map((f) => f.check_key);

const allKeys = (ctx: ReconciliationContext) =>
  runReconciliationChecks(ctx).map((f) => f.check_key);

describe("reconciliation efficacy", () => {
  test("a clean, internally-consistent deal raises no error flags", () => {
    expect(errorKeys(cleanContext())).toEqual([]);
  });

  test("sources_vs_uses fires when equity + debt do not fund TDC", () => {
    expect(errorKeys(cleanContext({ loan: 50_000_000 }))).toContain("sources_vs_uses");
  });

  test("ltc_consistency fires when the stated LTC disagrees with loan / TDC", () => {
    expect(errorKeys(cleanContext({ statedLtcPct: 60 }))).toContain("ltc_consistency");
  });

  test("covenant_feasibility fires when NOI cannot meet the min DSCR", () => {
    expect(errorKeys(cleanContext({ minDscr: 2.0 }))).toContain("covenant_feasibility");
  });

  test("debt_yield_covenant fires when the debt yield is below the covenant", () => {
    expect(errorKeys(cleanContext({ debtYieldPct: 6 }))).toContain("debt_yield_covenant");
  });

  test("occupancy_vs_lender fires (as a warning) when a component is below the lender requirement", () => {
    const keys = allKeys(
      cleanContext({ componentOccupancies: [{ unitType: "Residential", occupancyPct: 80 }] }),
    );
    expect(keys).toContain("occupancy_vs_lender:Residential");
  });

  test("budget_vs_stated_total fires when the budget sum diverges from the stated total", () => {
    expect(errorKeys(cleanContext({ budgetSum: 120_000_000 }))).toContain("budget_vs_stated_total");
  });

  test("unit_count_consistency fires when documents disagree on unit count", () => {
    expect(errorKeys(cleanContext({ unitCounts: [200, 250] }))).toContain("unit_count_consistency");
  });

  test("a fully interest-only deal is judged on its IO payment, not the amortizing constant", () => {
    // IO payment (3.5M) comfortably covered by NOI (7M) at 1.25x; the amortizing
    // constant must not false-fail it when IO covers the whole hold.
    const io = cleanContext({ ioCoversHold: true, amortizingAnnualDebtService: 9_000_000 });
    expect(errorKeys(io)).not.toContain("covenant_feasibility");
  });
});
