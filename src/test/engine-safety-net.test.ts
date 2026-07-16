// Tier 2 hardening: prove the safety nets actually catch what they must.
//
// (2a) the engine-input boundary warns on unusual-but-possible stressed values,
//      hard-blocks impossible values before assembly, and
// (2b) every reconciliation check fires on a deal engineered to trip it and stays
//      silent on a clean one.

import { describe, expect, test } from "vitest";
import {
  computeReadiness,
  mapleHeightsInput,
  runReconciliationChecks,
  runUnderwriting,
  validateEngineInput,
  type ProjectInputRows,
  type ReconciliationContext,
  type UnderwritingInput,
} from "@/lib/engine";

// ---------- 2a. Input plausibility boundary ----------

describe("engine-input plausibility boundary", () => {
  const sensible = mapleHeightsInput() as UnderwritingInput;
  const approvedRows = (): ProjectInputRows => ({
    scalars: [
      ["loan_amount", sensible.loanAmount],
      ["interest_rate_pct", sensible.interestRatePct],
      ["amort_years", sensible.amortYears],
      ["equity_amount", sensible.equityAmount],
      ["exit_cap_rate_pct", sensible.exitCapRatePct],
      ["expense_ratio_pct", sensible.expenseRatioPct],
      ["hold_years", sensible.holdYears],
      ["selling_costs_pct", sensible.sellingCostsPct],
      ["stabilized_occupancy_pct", sensible.stabilizedOccupancyPct],
    ].map(([key, value]) => ({
      key: String(key),
      value_numeric: Number(value),
      status: "approved",
    })),
    budget: [
      ["land", sensible.budget.land],
      ["hard", sensible.budget.hard],
      ["soft", sensible.budget.soft],
      ["contingency", sensible.budget.contingency],
      ["financing_interest", sensible.budget.financingInterest],
    ].map(([category, amount]) => ({
      category: category as ProjectInputRows["budget"][number]["category"],
      amount: Number(amount),
      status: "approved",
    })),
    revenue: sensible.revenueProgram.map((r) => ({
      unit_type: r.unitType,
      unit_count: r.unitCount,
      avg_sf: r.avgSf,
      rent: r.rent,
      rent_basis: r.rentBasis,
      occupancy_pct: r.occupancyPct,
      status: "approved",
    })),
  });

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
    ["interestRatePct", { interestRatePct: 45 }],
    ["exitCapRatePct", { exitCapRatePct: 45 }],
    ["rentGrowthPct", { rentGrowthPct: 30 }],
    ["expenseGrowthPct", { expenseGrowthPct: -30 }],
  ])("warns on unusual but possible %s", (field, override) => {
    const violations = validateEngineInput({ ...sensible, ...override } as UnderwritingInput);
    expect(violations.some((v) => v.field === field)).toBe(true);
  });

  test.each([
    ["interest_rate_pct:outside_0_100", { scalar: ["interest_rate_pct", 600] }],
    ["exit_cap_rate_pct:outside_0_100", { scalar: ["exit_cap_rate_pct", 0] }],
    ["expense_ratio_pct:outside_0_100", { scalar: ["expense_ratio_pct", 350] }],
    ["stabilized_occupancy_pct:outside_0_100", { scalar: ["stabilized_occupancy_pct", 9400] }],
    ["loan_amount:negative", { scalar: ["loan_amount", -1] }],
    ["hold_years:not_positive", { scalar: ["hold_years", 0] }],
  ])("hard-blocks impossible scalar %s", (reason, override) => {
    const rows = approvedRows();
    const [key, value] = override.scalar as [string, number];
    const row = rows.scalars.find((r) => r.key === key);
    if (!row) throw new Error(`Missing scalar fixture row: ${key}`);
    row.value_numeric = value;

    const readiness = computeReadiness(rows);
    expect(readiness.status).toBe("blocked");
    expect(readiness.impossible).toContain(reason);
  });

  test("a negative budget line hard-blocks readiness", () => {
    const rows = approvedRows();
    const hard = rows.budget.find((b) => b.category === "hard");
    if (!hard) throw new Error("Missing hard-cost fixture row");
    hard.amount = -28_000_000;

    const readiness = computeReadiness(rows);
    expect(readiness.status).toBe("blocked");
    expect(readiness.impossible).toContain("budget:hard:negative");
  });

  test("non-finite budget and revenue values hard-block instead of entering the engine", () => {
    const rows = approvedRows();
    const hard = rows.budget.find((b) => b.category === "hard");
    if (!hard) throw new Error("Missing hard-cost fixture row");
    hard.amount = Number.POSITIVE_INFINITY;
    rows.revenue[0]!.rent = Number.NaN;

    const readiness = computeReadiness(rows);
    expect(readiness.status).toBe("blocked");
    expect(readiness.impossible).toContain("budget:hard:not_finite");
    expect(readiness.impossible).toContain("revenue:1BR:rent_not_finite");
  });

  test("optional other budget lines fail closed once they are present", () => {
    const nonFinite = approvedRows();
    nonFinite.budget.push({
      category: "other",
      amount: Number.POSITIVE_INFINITY,
      status: "approved",
    });
    expect(computeReadiness(nonFinite).impossible).toContain("budget:other:not_finite");

    const conflicting = approvedRows();
    conflicting.budget.push({ category: "other", amount: 250_000, status: "conflicting" });
    expect(computeReadiness(conflicting).conflicting).toContain("budget:other");
  });

  test("negative rent and unit count hard-block per component", () => {
    const rows = approvedRows();
    rows.revenue = [
      {
        unit_type: "Residential",
        unit_count: -1,
        rent: -1,
        rent_basis: "per_unit",
        occupancy_pct: 95,
        status: "approved",
      },
    ];

    const readiness = computeReadiness(rows);
    expect(readiness.status).toBe("blocked");
    expect(readiness.impossible).toContain("revenue:Residential:negative_rent");
    expect(readiness.impossible).toContain("revenue:Residential:negative_units");
  });

  test("unusual-but-possible violations surface as engine warnings, and a clean deal adds none", () => {
    const clean = runUnderwriting(sensible);
    expect(clean.warnings.some((w) => w.key.startsWith("input_plausibility:"))).toBe(false);

    const slipped = runUnderwriting({ ...sensible, interestRatePct: 45 });
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
