// Tier 1 hardening: golden snapshots of the full engine output for a matrix of
// canonical deals. Any change that moves a number must be a DELIBERATE
// re-baseline (`vitest -u`), so a refactor can never silently shift a metric.
// Values are rounded to 4 decimals to absorb float noise while still pinning
// every figure to its expected magnitude.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  computeReadiness,
  conservativePick,
  DEFAULTS,
  mapleHeightsInput,
  runReconciliationChecks,
  runUnderwriting,
  type ProjectInputRows,
  type UnderwritingInput,
  type WaterfallConfig,
} from "@/lib/engine";
import { harbourSeedRows } from "@/lib/engine/harbour-fixture";
import { computeInvestmentVerdict } from "@/lib/verdict";

function rounded(values: Record<string, number | undefined>) {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : (v ?? null);
  }
  return out;
}

function roundValue(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1e4) / 1e4;
}

function acceptDefaults(rows: ProjectInputRows, keys: string[]) {
  for (const key of keys) {
    const def = DEFAULTS[key];
    if (!def) throw new Error(`No static default for ${key}`);
    rows.scalars.push({
      key,
      value_numeric: def.value,
      status: "default_accepted",
      source: "default",
    });
  }
}

function resolveConservative(rows: ProjectInputRows, key: string) {
  const row = rows.scalars.find((r) => r.key === key && r.status === "conflicting");
  if (!row?.conflict_values?.length) return null;
  const value = conservativePick(
    key,
    row.conflict_values.map((c) => c.value),
  );
  row.value_numeric = value;
  row.status = "approved";
  return value;
}

function summitRows(): ProjectInputRows {
  return {
    scalars: [
      { key: "loan_amount", value_numeric: 200_400_000, status: "approved" },
      { key: "interest_rate_pct", value_numeric: 7.15, status: "approved" },
      { key: "amort_years", value_numeric: 30, status: "approved" },
      { key: "equity_amount", value_numeric: 133_600_000, status: "approved" },
      { key: "exit_cap_rate_pct", value_numeric: 5.75, status: "approved" },
      { key: "expense_ratio_pct", value_numeric: 27, status: "approved" },
      { key: "hold_years", value_numeric: 5, status: "approved" },
      { key: "selling_costs_pct", value_numeric: 2, status: "approved" },
      { key: "other_income_annual", value_numeric: 1_400_000, status: "approved" },
    ],
    budget: [
      { category: "land", amount: 42_000_000, status: "approved" },
      { category: "hard", amount: 220_000_000, status: "approved" },
      { category: "soft", amount: 39_500_000, status: "approved" },
      { category: "contingency", amount: 12_000_000, status: "approved" },
      { category: "financing_interest", amount: 17_250_000, status: "approved" },
      { category: "other", amount: 6_500_000, status: "approved" },
      { category: "other", amount: 9_000_000, status: "approved" },
    ],
    revenue: [
      {
        unit_type: "Dry Warehouse",
        unit_count: 1,
        avg_sf: 760000,
        rent: 18.5,
        rent_basis: "per_sf",
        occupancy_pct: 96,
        status: "approved",
      },
      {
        unit_type: "Cold Storage",
        unit_count: 1,
        avg_sf: 280000,
        rent: 31,
        rent_basis: "per_sf",
        occupancy_pct: 94,
        status: "approved",
      },
      {
        unit_type: "Last-Mile Flex",
        unit_count: 1,
        avg_sf: 200000,
        rent: 23.5,
        rent_basis: "per_sf",
        occupancy_pct: 92,
        status: "approved",
      },
    ],
  };
}

function professionalGolden(name: string, rows: ProjectInputRows) {
  const readiness = computeReadiness(rows);
  const input = assembleEngineInput(rows);
  const output = runUnderwriting(input);
  const v = output.values;
  const equityAmount = Number(input.equityAmount ?? 0);
  const loanAmount = Number(input.loanAmount ?? 0);
  const flags = runReconciliationChecks({
    tdc: v.tdc,
    equity: equityAmount,
    loan: loanAmount,
    noi: v.noi,
    amortizingAnnualDebtService: v.annualDebtService,
    minDscr: 1.2,
    lenderStabilizedOccupancyPct: name === "Harbour Centre" ? 93 : undefined,
    componentOccupancies: input.revenueProgram.map((r) => ({
      unitType: r.unitType,
      occupancyPct: r.occupancyPct ?? null,
    })),
    unitCounts: name === "Harbour Centre" ? [220, 220] : undefined,
  });
  const errorFlags = flags.filter((f) => f.severity === "error");
  const verdict = computeInvestmentVerdict({
    equity_multiple: v.equityMultiple,
    profit_margin: v.profitOnCostPct,
    development_spread: v.developmentSpreadBps,
    stress_dscr: v.dscr,
    stress_equity_multiple: v.equityMultiple,
    equity_wipeout: output.equityWipeout,
    error_flag_count: errorFlags.length,
  });
  return {
    name,
    approvedAssumptions: {
      loanAmount,
      equityAmount,
      interestRatePct: input.interestRatePct,
      exitCapRatePct: input.exitCapRatePct,
      expenseRatioPct: input.expenseRatioPct,
    },
    readiness,
    metrics: {
      tdc: Math.round(v.tdc),
      gpr: Math.round(v.gpr),
      egi: Math.round(v.egi),
      noi: Math.round(v.noi),
      ltcPct: roundValue(v.ltcPct),
      dscr: roundValue(v.dscr),
      developmentProfit: Math.round(v.developmentProfit),
      profitOnCostPct: roundValue(v.profitOnCostPct),
      yieldOnCostPct: roundValue(v.yieldOnCostPct),
      irrPct: roundValue(v.irrPct),
      equityMultiple: roundValue(v.equityMultiple),
    },
    verdict: verdict.code,
    riskFlags: flags.map((f) => ({
      key: f.check_key,
      severity: f.severity,
      actual: roundValue(f.actual ?? undefined),
      expected: roundValue(f.expected ?? undefined),
    })),
    reconciliationFlags: flags.map((f) => f.check_key),
  };
}

function deal(overrides: Partial<UnderwritingInput> = {}): UnderwritingInput {
  return {
    budget: { land: 8_000_000, hard: 60_000_000, soft: 9_000_000, contingency: 3_000_000 },
    revenueProgram: [
      { unitType: "Residential", unitCount: 200, rent: 2_900, rentBasis: "per_unit" },
    ],
    constructionMonths: 18,
    leaseUpMonths: 12,
    stabilizedOccupancyPct: 94,
    expenseRatioPct: 36,
    otherIncomeAnnual: 300_000,
    exitCapRatePct: 5.25,
    loanAmount: 54_000_000,
    interestRatePct: 6.5,
    amortYears: 30,
    ioMonths: 24,
    avgOutstandingFactor: 0.55,
    sellingCostsPct: 2,
    holdYears: 5,
    equityAmount: 26_000_000,
    rentGrowthPct: 3,
    expenseGrowthPct: 2,
    ...overrides,
  };
}

const PROMOTE: WaterfallConfig = {
  lpEquityPct: 90,
  gpEquityPct: 10,
  preferredReturnPct: 8,
  gpCatchUpPct: 50,
  tiers: [{ hurdlePct: 12, gpPct: 20 }, { hurdlePct: 18, gpPct: 30 }, { gpPct: 40 }],
};

const GOLDEN: Array<{ name: string; deal: UnderwritingInput }> = [
  { name: "maple heights (marginal)", deal: mapleHeightsInput() as UnderwritingInput },
  { name: "stabilized mid-rise (annual)", deal: deal() },
  { name: "stabilized mid-rise (monthly spine)", deal: deal({ monthlyModel: true }) },
  { name: "interest-only senior", deal: deal({ ioMonths: 60 }) },
  { name: "fully amortizing senior", deal: deal({ ioMonths: 0 }) },
  {
    name: "mezzanine tranche",
    deal: deal({ mezzanine: { amount: 6_000_000, ratePct: 11, amortYears: 30, ioMonths: 24 } }),
  },
  {
    name: "refinance mid-hold (monthly)",
    deal: deal({
      monthlyModel: true,
      holdYears: 7,
      refinance: { month: 42, ltvPct: 65, ratePct: 5.5, amortYears: 30, ioMonths: 0 },
    }),
  },
  { name: "lp/gp promote waterfall", deal: deal({ waterfall: PROMOTE }) },
  { name: "lease-up absorption (monthly)", deal: deal({ monthlyModel: true, leaseUpCurve: true }) },
  {
    name: "commercial per-sf program",
    deal: deal({
      revenueProgram: [
        { unitType: "Office", unitCount: 1, avgSf: 120_000, rent: 38, rentBasis: "per_sf" },
        { unitType: "Retail", unitCount: 1, avgSf: 18_000, rent: 45, rentBasis: "per_sf" },
      ],
    }),
  },
  {
    name: "distressed (cap expansion, soft rents)",
    deal: deal({
      exitCapRatePct: 9,
      stabilizedOccupancyPct: 80,
      loanAmount: 62_000_000,
      revenueProgram: [
        { unitType: "Residential", unitCount: 200, rent: 1_900, rentBasis: "per_unit" },
      ],
    }),
  },
];

describe("golden engine output snapshots", () => {
  for (const { name, deal: d } of GOLDEN) {
    test(`stable values: ${name}`, () => {
      expect(rounded(runUnderwriting(d).values)).toMatchSnapshot();
    });
  }

  test("professional golden outputs for named fixture deals", () => {
    const harbour = harbourSeedRows();
    const blocked = computeReadiness(harbour);
    expect(blocked.status).toBe("blocked");
    expect(blocked.conflicting).toEqual(["exit_cap_rate_pct"]);
    acceptDefaults(harbour, blocked.defaultable);
    expect(resolveConservative(harbour, "exit_cap_rate_pct")).toBe(5.25);

    const summit = summitRows();
    expect(computeReadiness(summit).status).toBe("ready");

    const golden = [
      professionalGolden("Harbour Centre", harbour),
      professionalGolden("Summit Point Logistics Park", summit),
    ];
    expect(golden[0].metrics.tdc).toBe(250_000_000);
    expect(golden[0].metrics.dscr).toBeCloseTo(0.5091, 4);
    expect(golden[0].verdict).toBe("REJECT");
    expect(golden[1].metrics.tdc).toBe(346_250_000);
    expect(golden[1].metrics.egi).toBe(27_380_800);
    expect(golden).toMatchSnapshot();
  });
});
