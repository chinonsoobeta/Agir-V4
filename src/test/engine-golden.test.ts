// Tier 1 hardening: golden snapshots of the full engine output for a matrix of
// canonical deals. Any change that moves a number must be a DELIBERATE
// re-baseline (`vitest -u`), so a refactor can never silently shift a metric.
// Values are rounded to 4 decimals to absorb float noise while still pinning
// every figure to its expected magnitude.

import { describe, expect, test } from "vitest";
import {
  mapleHeightsInput,
  runUnderwriting,
  type UnderwritingInput,
  type WaterfallConfig,
} from "@/lib/engine";

function rounded(values: Record<string, number | undefined>) {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : (v ?? null);
  }
  return out;
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
});
